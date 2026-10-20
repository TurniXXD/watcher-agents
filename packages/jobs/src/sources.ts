import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { fetchJobSource, responseCheckpoint } from './http.js';
import {
  canonicalizeUrl,
  cleanHtml,
  extractTechnologyStack,
} from './normalization.js';
import {
  normalizedJobSchema,
  type JobSourceAdapter,
  type JobSourceDefinition,
  type NormalizedJob,
} from './types.js';

const optionalDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const inferWorkMode = (
  location: string | undefined,
  text: string,
): NormalizedJob['workMode'] => {
  const value = `${location ?? ''} ${text}`;
  if (/\bhybrid\b/iu.test(value)) return 'HYBRID';
  if (/\bremote\b|worldwide|anywhere/iu.test(value)) return 'REMOTE';
  if (location) return 'ONSITE';
  return 'UNKNOWN';
};

const commaSeparatedValues = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value): string[] => {
    if (Array.isArray(value))
      return value.map((item) => item.trim()).filter(Boolean);
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  });

const remoteFrontendItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  board: z.string().optional(),
  location: z.string().nullable().optional(),
  geoRegions: commaSeparatedValues,
  geoLabel: z.string().nullable().optional(),
  salaryMinYearly: z.number().nullable().optional(),
  salaryMaxYearly: z.number().nullable().optional(),
  salary: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  isoDate: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  link: z.url(),
  tags: commaSeparatedValues,
  contentSnippet: z.string().optional().default(''),
  content: z.string().optional(),
  workModel: z.string().nullable().optional(),
  forcedRemote: z.boolean().optional(),
  company: z.object({ name: z.string() }),
});

const mapRemoteFrontend = (
  sourceId: string,
  input: z.infer<typeof remoteFrontendItemSchema>,
): NormalizedJob => {
  const description = cleanHtml(input.content ?? input.contentSnippet);
  const location = input.location ?? input.geoLabel ?? undefined;
  const applicationUrl = canonicalizeUrl(input.link);
  const sourceUrl = `https://www.remotefrontendjobs.com/${encodeURIComponent(input.id)}`;
  return normalizedJobSchema.parse({
    externalId: input.id,
    sourceId,
    title: input.title,
    company: input.company.name,
    description,
    shortDescription: cleanHtml(input.contentSnippet).slice(0, 500),
    ...(location ? { location } : {}),
    workMode: input.forcedRemote
      ? 'REMOTE'
      : inferWorkMode(location, `${input.workModel ?? ''} ${description}`),
    remoteRegions: input.geoRegions,
    ...(input.salaryMinYearly ? { salaryMin: input.salaryMinYearly } : {}),
    ...(input.salaryMaxYearly ? { salaryMax: input.salaryMaxYearly } : {}),
    ...(input.salaryMinYearly || input.salaryMaxYearly
      ? { salaryCurrency: 'USD', salaryPeriod: 'YEAR' }
      : {}),
    ...(input.seniority ? { seniority: input.seniority } : {}),
    technologyStack: extractTechnologyStack(
      `${input.tags.join(' ')} ${description}`,
    ),
    originalUrl: sourceUrl,
    canonicalApplicationUrl: applicationUrl,
    ...(optionalDate(input.createdAt ?? input.isoDate)
      ? { publishedAt: optionalDate(input.createdAt ?? input.isoDate) }
      : {}),
    ...(optionalDate(input.updatedAt)
      ? { updatedAt: optionalDate(input.updatedAt) }
      : {}),
    raw: input,
  });
};

export const parseRemoteFrontendJob = (
  sourceId: string,
  input: unknown,
): NormalizedJob =>
  mapRemoteFrontend(sourceId, remoteFrontendItemSchema.parse(input));

const remoteFrontendAdapter = (
  board: 'frontend' | 'backend',
): JobSourceAdapter => {
  const id = `remote-${board}-jobs`;
  const listingUrl = `https://www.remotefrontendjobs.com/api/jobs?board=${board}&limit=100`;
  return {
    id,
    name: `Remote ${board === 'frontend' ? 'Frontend' : 'Backend'} Jobs`,
    baseUrl: 'https://www.remotefrontendjobs.com',
    strategy: 'API',
    attribution: 'Jobs by Remote Frontend Jobs',
    fetchIntervalMinutes: 60,
    rateLimitPerMinute: 120,
    discover: async ({ checkpoint, signal }) => {
      const response = await fetchJobSource(listingUrl, {
        accept: 'application/json',
        ...(checkpoint ? { checkpoint } : {}),
        ...(signal ? { signal } : {}),
      });
      if (response.status === 304)
        return {
          jobs: [],
          notModified: true,
          ...(checkpoint ? { checkpoint } : {}),
        };
      const items = z
        .array(remoteFrontendItemSchema)
        .parse(await response.json());
      return {
        jobs: items.map((item) => parseRemoteFrontendJob(id, item)),
        checkpoint: responseCheckpoint(response),
      };
    },
    fetchDetail: async (job, { signal }) => {
      const response = await fetchJobSource(
        `https://www.remotefrontendjobs.com/api/jobs/${encodeURIComponent(job.externalId)}`,
        {
          accept: 'application/json',
          ...(signal ? { signal } : {}),
        },
      );
      return parseRemoteFrontendJob(id, await response.json());
    },
  };
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const scalar = (value: unknown): string | undefined => {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string' || typeof text === 'number')
      return String(text);
  }
  return undefined;
};

const scalars = (value: unknown): string[] =>
  asArray(value)
    .map((item) => scalar(item))
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim());

const rssAdapter = (input: {
  id: string;
  name: string;
  url: string;
  baseUrl: string;
  attribution: string;
  defaultCompany?: string;
}): JobSourceAdapter => ({
  id: input.id,
  name: input.name,
  baseUrl: input.baseUrl,
  strategy: 'RSS',
  attribution: input.attribution,
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 30,
  discover: async ({ checkpoint, signal }) => {
    const response = await fetchJobSource(input.url, {
      accept: 'application/rss+xml, application/xml, text/xml',
      ...(checkpoint ? { checkpoint } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 304)
      return {
        jobs: [],
        notModified: true,
        ...(checkpoint ? { checkpoint } : {}),
      };
    const document = z
      .record(z.string(), z.unknown())
      .parse(xmlParser.parse(await response.text()));
    const rss = (document.rss ?? document.feed) as
      Record<string, unknown> | undefined;
    const channel = (rss?.channel ?? rss) as
      Record<string, unknown> | undefined;
    const rawItems = asArray(channel?.item ?? channel?.entry);
    const jobs = rawItems.flatMap((raw): NormalizedJob[] => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Record<string, unknown>;
      const titleValue = scalar(item.title)?.trim();
      const linkValue =
        scalar(item.link) ?? scalar(item.guid) ?? scalar(item.id);
      if (!titleValue || !linkValue) return [];
      let link: string;
      try {
        link = canonicalizeUrl(linkValue);
      } catch {
        return [];
      }
      const description = cleanHtml(
        scalar(item.encoded) ??
          scalar(item.description) ??
          scalar(item.summary) ??
          '',
      );
      const company =
        scalar(item.companyName) ??
        scalar(item.company) ??
        titleValue.split(/\s+(?:at|@|–|-|\|)\s+/u).at(-1) ??
        input.defaultCompany ??
        'Unknown company';
      const title = titleValue.replace(
        new RegExp(
          `\\s+(?:at|@|–|-|\\|)\\s+${company.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
          'iu',
        ),
        '',
      );
      const remoteRegions = [
        ...scalars(item.locationRestriction),
        ...scalars(item.timezoneRestriction),
      ];
      const location =
        scalar(item.location) ??
        scalar(item.jobLocation) ??
        (remoteRegions.length ? remoteRegions.join(', ') : undefined);
      const publishedAt = optionalDate(
        scalar(item.pubDate) ?? scalar(item.published) ?? scalar(item.updated),
      );
      const externalId = scalar(item.guid) ?? scalar(item.id) ?? link;
      const parsed = normalizedJobSchema.safeParse({
        externalId,
        sourceId: input.id,
        title,
        company,
        description,
        shortDescription: description.slice(0, 500),
        ...(location ? { location } : {}),
        workMode:
          remoteRegions.length > 0
            ? 'REMOTE'
            : inferWorkMode(location, description),
        remoteRegions,
        technologyStack: extractTechnologyStack(`${title} ${description}`),
        originalUrl: link,
        canonicalApplicationUrl: link,
        ...(publishedAt ? { publishedAt } : {}),
        raw: item,
      });
      return parsed.success ? [parsed.data] : [];
    });
    return { jobs, checkpoint: responseCheckpoint(response) };
  },
});

const remoteOkSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  position: z.string(),
  company: z.string(),
  description: z.string().optional().default(''),
  location: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  url: z.url(),
  apply_url: z.url().optional(),
  date: z.string().optional(),
  epoch: z.number().optional(),
  salary_min: z.number().optional(),
  salary_max: z.number().optional(),
});

export const parseRemoteOkJob = (value: unknown): NormalizedJob => {
  const item = remoteOkSchema.parse(value);
  const description = cleanHtml(item.description);
  const originalUrl = canonicalizeUrl(item.url);
  return normalizedJobSchema.parse({
    externalId: item.id,
    sourceId: 'remote-ok',
    title: item.position,
    company: item.company,
    description,
    shortDescription: description.slice(0, 500),
    ...(item.location ? { location: item.location } : {}),
    workMode: 'REMOTE',
    remoteRegions: item.location ? [item.location] : [],
    ...(item.salary_min ? { salaryMin: item.salary_min } : {}),
    ...(item.salary_max ? { salaryMax: item.salary_max } : {}),
    technologyStack: extractTechnologyStack(
      `${item.tags.join(' ')} ${description}`,
    ),
    originalUrl,
    ...(item.apply_url
      ? { canonicalApplicationUrl: canonicalizeUrl(item.apply_url) }
      : { canonicalApplicationUrl: originalUrl }),
    ...(optionalDate(item.date)
      ? { publishedAt: optionalDate(item.date) }
      : item.epoch
        ? { publishedAt: new Date(item.epoch * 1_000) }
        : {}),
    raw: item,
  });
};

const remoteOkAdapter = (): JobSourceAdapter => ({
  id: 'remote-ok',
  name: 'Remote OK',
  baseUrl: 'https://remoteok.com',
  strategy: 'API',
  attribution: 'Remote jobs by Remote OK',
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 30,
  discover: async ({ checkpoint, signal }) => {
    const response = await fetchJobSource('https://remoteok.com/api', {
      accept: 'application/json',
      ...(checkpoint ? { checkpoint } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 304)
      return {
        jobs: [],
        notModified: true,
        ...(checkpoint ? { checkpoint } : {}),
      };
    const values = z.array(z.unknown()).parse(await response.json());
    const items = values.flatMap((value) => {
      const parsed = remoteOkSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
    return {
      jobs: items.map(parseRemoteOkJob),
      checkpoint: responseCheckpoint(response),
    };
  },
});

export const createJobSourceDefinitions = (): JobSourceDefinition[] => {
  const enabled = [
    remoteFrontendAdapter('frontend'),
    remoteFrontendAdapter('backend'),
    rssAdapter({
      id: 'himalayas',
      name: 'Himalayas',
      url: 'https://himalayas.app/jobs/rss',
      baseUrl: 'https://himalayas.app',
      attribution: 'Remote jobs by Himalayas',
    }),
    rssAdapter({
      id: 'startup-jobs',
      name: 'Startup Jobs',
      url: 'https://startup.jobs/feeds/jobs?role=engineering',
      baseUrl: 'https://startup.jobs',
      attribution: 'Jobs by Startup Jobs',
    }),
    rssAdapter({
      id: 'remote-first-jobs',
      name: 'RemoteFirstJobs',
      url: 'https://remotefirstjobs.com/rss/jobs/software-development.rss',
      baseUrl: 'https://remotefirstjobs.com',
      attribution: 'Remote jobs by RemoteFirstJobs',
    }),
    remoteOkAdapter(),
  ];
  const definitions: JobSourceDefinition[] = enabled.map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    strategy: adapter.strategy,
    enabledByDefault: true,
    attribution: adapter.attribution,
    fetchIntervalMinutes: adapter.fetchIntervalMinutes,
    rateLimitPerMinute: adapter.rateLimitPerMinute,
    adapter,
  }));
  const unsupported = [
    ['developerjobs-ch', 'DeveloperJobs.ch', 'https://www.developerjobs.ch'],
    ['cooljobs-eu', 'CoolJobs.eu', 'https://www.cooljobs.eu'],
    ['startupjobs-cz', 'StartupJobs.cz', 'https://www.startupjobs.cz'],
    ['prace-za-rohem', 'Práce za rohem', 'https://www.pracezarohem.cz'],
    ['linkedin', 'LinkedIn', 'https://www.linkedin.com/jobs'],
    ['jobs-cz', 'Jobs.cz', 'https://www.jobs.cz'],
    ['prace-cz', 'Prace.cz', 'https://www.prace.cz'],
    ['jobstack-it', 'Jobstack.it', 'https://www.jobstack.it'],
    [
      'welcome-to-the-jungle',
      'Welcome to the Jungle',
      'https://www.welcometothejungle.com',
    ],
    ['jobsi-cz', 'Jobsi.cz', 'https://www.jobsi.cz'],
    ['jenprace-cz', 'JenPrace.cz', 'https://www.jenprace.cz'],
    ['jobs-ch', 'Jobs.ch', 'https://www.jobs.ch'],
    ['jobscout24-ch', 'JobScout24.ch', 'https://www.jobscout24.ch'],
    ['swissdevjobs', 'SwissDevJobs', 'https://swissdevjobs.ch'],
    [
      'english-speaking-jobs-ch',
      'English Speaking Jobs Switzerland',
      'https://englishspeakingjobs.ch',
    ],
    ['ictcareer-ch', 'ICTcareer.ch', 'https://www.ictcareer.ch'],
    ['we-work-remotely', 'We Work Remotely', 'https://weworkremotely.com'],
    ['remotive', 'Remotive', 'https://remotive.com'],
    ['wellfound', 'Wellfound', 'https://wellfound.com/jobs'],
    ['working-nomads', 'Working Nomads', 'https://www.workingnomads.com/jobs'],
    ['flexjobs', 'FlexJobs', 'https://www.flexjobs.com'],
    ['eures', 'EURES', 'https://eures.europa.eu'],
    ['greenhouse', 'Greenhouse curated boards', 'https://www.greenhouse.com'],
    ['lever', 'Lever curated boards', 'https://www.lever.co'],
    ['ashby', 'Ashby curated boards', 'https://www.ashbyhq.com'],
    [
      'smartrecruiters',
      'SmartRecruiters curated companies',
      'https://www.smartrecruiters.com',
    ],
    ['workable', 'Workable curated companies', 'https://www.workable.com'],
    ['recruitee', 'Recruitee curated companies', 'https://recruitee.com'],
    [
      'teamtailor',
      'Teamtailor curated companies',
      'https://www.teamtailor.com',
    ],
  ] as const;
  return [
    ...definitions,
    ...unsupported.map(([id, name, baseUrl]) => ({
      id,
      name,
      baseUrl,
      strategy: 'DISABLED',
      enabledByDefault: false,
      disabledReason:
        'No verified permitted public job-seeker API or feed is configured. Automated scraping is intentionally disabled.',
    })),
  ];
};
