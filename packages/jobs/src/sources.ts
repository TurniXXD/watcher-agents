import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import {
  createAgodaCareersAdapter,
  createConfiguredAtsDefinitions,
  type AtsSourceConfiguration,
} from './ats-sources.js';
import { createDeveloperJobsAdapter } from './developerjobs-source.js';
import {
  createCoolJobsAdapter,
  createJenPraceAdapter,
  createJobsCzAdapter,
  createJobsiAdapter,
  createJobstackAdapter,
  createPraceCzAdapter,
  createPraceZaRohemAdapter,
} from './czech-job-sources.js';
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
import { createStartupJobsCzAdapter } from './startupjobs-source.js';
import {
  createArbeitnowAdapter,
  createJobicyAdapter,
} from './public-api-sources.js';

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

export const createRssJobSourceAdapter = (input: {
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

const workingNomadsItemSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  description: z.string().optional().default(''),
  company_name: z.string().trim().min(1),
  category_name: z.string().optional(),
  tags: z.string().optional().default(''),
  location: z.string().optional(),
  pub_date: z.string().optional(),
});

export const parseWorkingNomadsJob = (value: unknown): NormalizedJob => {
  const item = workingNomadsItemSchema.parse(value);
  const description = cleanHtml(item.description);
  const originalUrl = canonicalizeUrl(item.url);
  const externalId = new URL(originalUrl).pathname
    .split('/')
    .filter(Boolean)
    .at(-1);
  return normalizedJobSchema.parse({
    externalId: externalId ?? originalUrl,
    sourceId: 'working-nomads',
    title: item.title,
    company: item.company_name,
    description,
    shortDescription: description.slice(0, 500),
    ...(item.location ? { location: item.location } : {}),
    workMode: 'REMOTE',
    remoteRegions: item.location ? [item.location] : [],
    ...(item.category_name ? { contractType: item.category_name } : {}),
    technologyStack: extractTechnologyStack(
      `${item.tags.replaceAll(',', ' ')} ${item.title} ${description}`,
    ),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(optionalDate(item.pub_date)
      ? { publishedAt: optionalDate(item.pub_date) }
      : {}),
    raw: item,
  });
};

const workingNomadsAdapter = (): JobSourceAdapter => ({
  id: 'working-nomads',
  name: 'Working Nomads',
  baseUrl: 'https://www.workingnomads.com',
  strategy: 'API',
  attribution: 'Remote jobs by Working Nomads',
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 30,
  discover: async ({ checkpoint, signal }) => {
    const response = await fetchJobSource(
      'https://www.workingnomads.com/api/exposed_jobs/',
      {
        accept: 'application/json',
        ...(checkpoint ? { checkpoint } : {}),
        ...(signal ? { signal } : {}),
      },
    );
    if (response.status === 304)
      return {
        jobs: [],
        notModified: true,
        ...(checkpoint ? { checkpoint } : {}),
      };
    const values = z.array(z.unknown()).parse(await response.json());
    const jobs = values.flatMap((value): NormalizedJob[] => {
      const parsed = workingNomadsItemSchema.safeParse(value);
      return parsed.success ? [parseWorkingNomadsJob(parsed.data)] : [];
    });
    return { jobs, checkpoint: responseCheckpoint(response) };
  },
});

export const createJobSourceDefinitions = (
  atsConfiguration: AtsSourceConfiguration = {},
): JobSourceDefinition[] => {
  const enabled = [
    remoteFrontendAdapter('frontend'),
    remoteFrontendAdapter('backend'),
    createRssJobSourceAdapter({
      id: 'himalayas',
      name: 'Himalayas',
      url: 'https://himalayas.app/jobs/rss',
      baseUrl: 'https://himalayas.app',
      attribution: 'Remote jobs by Himalayas',
    }),
    createRssJobSourceAdapter({
      id: 'startup-jobs',
      name: 'Startup Jobs',
      url: 'https://startup.jobs/feeds/jobs?role=engineering',
      baseUrl: 'https://startup.jobs',
      attribution: 'Jobs by Startup Jobs',
    }),
    createRssJobSourceAdapter({
      id: 'remote-first-jobs',
      name: 'RemoteFirstJobs',
      url: 'https://remotefirstjobs.com/rss/jobs/software-development.rss',
      baseUrl: 'https://remotefirstjobs.com',
      attribution: 'Remote jobs by RemoteFirstJobs',
    }),
    createRssJobSourceAdapter({
      id: 'we-work-remotely',
      name: 'We Work Remotely',
      url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
      baseUrl: 'https://weworkremotely.com',
      attribution: 'Remote jobs by We Work Remotely',
    }),
    createRssJobSourceAdapter({
      id: 'remotive',
      name: 'Remotive',
      url: 'https://remotive.com/feed',
      baseUrl: 'https://remotive.com',
      attribution: 'Remote jobs by Remotive',
    }),
    createRssJobSourceAdapter({
      id: 'swissdevjobs',
      name: 'SwissDevJobs',
      url: 'https://swissdevjobs.ch/rss',
      baseUrl: 'https://swissdevjobs.ch',
      attribution: 'Swiss developer jobs by SwissDevJobs',
    }),
    createStartupJobsCzAdapter(),
    createAgodaCareersAdapter(),
    createDeveloperJobsAdapter(),
    createArbeitnowAdapter(),
    createJobicyAdapter(),
    workingNomadsAdapter(),
    remoteOkAdapter(),
    createCoolJobsAdapter(),
    createPraceZaRohemAdapter(),
    createJobsCzAdapter(),
    createPraceCzAdapter(),
    createJobstackAdapter(),
    createJobsiAdapter(),
    createJenPraceAdapter(),
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
    ['linkedin', 'LinkedIn', 'https://www.linkedin.com/jobs'],
    [
      'welcome-to-the-jungle',
      'Welcome to the Jungle',
      'https://www.welcometothejungle.com',
    ],
    ['jobs-ch', 'Jobs.ch', 'https://www.jobs.ch'],
    ['jobscout24-ch', 'JobScout24.ch', 'https://www.jobscout24.ch'],
    [
      'english-speaking-jobs-ch',
      'English Speaking Jobs Switzerland',
      'https://englishspeakingjobs.ch',
    ],
    ['ictcareer-ch', 'ICTcareer.ch', 'https://www.ictcareer.ch'],
    ['wellfound', 'Wellfound', 'https://wellfound.com/jobs'],
    ['flexjobs', 'FlexJobs', 'https://www.flexjobs.com'],
    ['eures', 'EURES', 'https://eures.europa.eu'],
  ] as const;
  const restrictedReasons: Partial<
    Record<(typeof unsupported)[number][0], string>
  > = {
    eures:
      'EURES permits API-style vacancy extraction only for recognized EURES partner organisations; partner authorization is not configured.',
    'english-speaking-jobs-ch':
      'The site robots policy disallows automated access to its job-category pages and no permitted public feed/API is published.',
    linkedin:
      'LinkedIn has no configured permitted public job-seeker feed/API; logged-in automation and scraping are intentionally unsupported.',
  };
  return [
    ...definitions,
    ...createConfiguredAtsDefinitions(atsConfiguration),
    ...unsupported.map(([id, name, baseUrl]) => ({
      id,
      name,
      baseUrl,
      strategy: 'DISABLED',
      enabledByDefault: false,
      disabledReason:
        restrictedReasons[id] ??
        'No verified permitted public job-seeker API or feed is configured. Automated scraping is intentionally disabled.',
    })),
  ];
};
