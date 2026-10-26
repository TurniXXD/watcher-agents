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
  type NormalizedJob,
} from './types.js';

const sourceId = 'startupjobs-cz';
const sitemapUrl = 'https://www.startupjobs.cz/sitemap/offers.xml';

const localizedTextSchema = z
  .object({
    cs: z.string().optional(),
    en: z.string().optional(),
  })
  .passthrough();

const jobPostingSchema = z
  .object({
    '@type': z.union([z.literal('JobPosting'), z.array(z.string())]),
    title: z.string().trim().min(1),
    description: z.string().default(''),
    url: z.url(),
    datePosted: z.string().optional(),
    validThrough: z.string().optional(),
    employmentType: z.union([z.string(), z.array(z.string())]).optional(),
    jobLocationType: z.string().optional(),
    identifier: z
      .union([
        z.string(),
        z.number(),
        z.object({ value: z.union([z.string(), z.number()]) }).passthrough(),
      ])
      .optional(),
    hiringOrganization: z.object({ name: z.string().trim().min(1) }),
    jobLocation: z
      .union([
        z.object({
          address: z
            .object({
              addressLocality: z.string().optional(),
              addressRegion: z.string().optional(),
              addressCountry: z
                .union([z.string(), localizedTextSchema])
                .optional(),
            })
            .optional(),
        }),
        z.array(
          z.object({
            address: z
              .object({
                addressLocality: z.string().optional(),
                addressRegion: z.string().optional(),
                addressCountry: z
                  .union([z.string(), localizedTextSchema])
                  .optional(),
              })
              .optional(),
          }),
        ),
      ])
      .optional(),
    applicantLocationRequirements: z
      .union([
        z.object({ name: z.string().optional() }),
        z.array(z.object({ name: z.string().optional() })),
      ])
      .optional(),
    baseSalary: z
      .object({
        currency: z.string().optional(),
        value: z
          .union([
            z.number(),
            z.object({
              minValue: z.number().optional(),
              maxValue: z.number().optional(),
              value: z.number().optional(),
              unitText: z.string().optional(),
            }),
          ])
          .optional(),
      })
      .optional(),
  })
  .passthrough();

type JobPosting = z.infer<typeof jobPostingSchema>;

const optionalDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const localizedText = (
  value: string | z.infer<typeof localizedTextSchema> | undefined,
): string | undefined =>
  typeof value === 'string' ? value : (value?.en ?? value?.cs);

const sitemapParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

const humanizeSlug = (slug: string): string =>
  decodeURIComponent(slug).replaceAll('-', ' ').replace(/\s+/gu, ' ').trim();

const sitemapJob = (urlValue: string): NormalizedJob | undefined => {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'www.startupjobs.cz') return undefined;
  const match = url.pathname.match(/^\/nabidka\/(\d+)\/([^/]+)\/?$/u);
  if (!match?.[1] || !match[2]) return undefined;
  const title = humanizeSlug(match[2]);
  const originalUrl = canonicalizeUrl(url.toString());
  return normalizedJobSchema.parse({
    externalId: match[1],
    sourceId,
    title,
    company: 'StartupJobs.cz listing',
    description: title,
    workMode: 'UNKNOWN',
    remoteRegions: [],
    technologyStack: extractTechnologyStack(title),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    raw: { sitemapUrl: originalUrl },
  });
};

export const parseStartupJobsSitemap = (xml: string): NormalizedJob[] => {
  const document = z
    .record(z.string(), z.unknown())
    .parse(sitemapParser.parse(xml));
  const urlset = z
    .object({
      url: z.union([
        z.object({ loc: z.string() }),
        z.array(z.object({ loc: z.string() })),
      ]),
    })
    .parse(document.urlset);
  const entries = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
  return entries.flatMap(({ loc }) => {
    const job = sitemapJob(loc);
    return job ? [job] : [];
  });
};

const isJobPosting = (value: unknown): value is JobPosting => {
  const parsed = jobPostingSchema.safeParse(value);
  if (!parsed.success) return false;
  return Array.isArray(parsed.data['@type'])
    ? parsed.data['@type'].includes('JobPosting')
    : parsed.data['@type'] === 'JobPosting';
};

const findJobPosting = (value: unknown): JobPosting | undefined => {
  if (isJobPosting(value)) return jobPostingSchema.parse(value);
  if (!value || typeof value !== 'object') return undefined;
  const graph = (value as Record<string, unknown>)['@graph'];
  if (!Array.isArray(graph)) return undefined;
  const posting = graph.find(isJobPosting);
  return posting ? jobPostingSchema.parse(posting) : undefined;
};

const extractJobPosting = (html: string): JobPosting => {
  for (const match of html.matchAll(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    try {
      const posting = findJobPosting(JSON.parse(match[1] ?? ''));
      if (posting) return posting;
    } catch {
      continue;
    }
  }
  throw new Error('StartupJobs page does not contain valid JobPosting JSON-LD');
};

const identifier = (posting: JobPosting, fallback: string): string => {
  if (typeof posting.identifier === 'string') return posting.identifier;
  if (typeof posting.identifier === 'number') return String(posting.identifier);
  if (posting.identifier?.value !== undefined)
    return String(posting.identifier.value);
  return fallback;
};

const locationDetails = (posting: JobPosting) => {
  const locations = !posting.jobLocation
    ? []
    : Array.isArray(posting.jobLocation)
      ? posting.jobLocation
      : [posting.jobLocation];
  const address = locations[0]?.address;
  const country = localizedText(address?.addressCountry);
  const parts = [
    address?.addressLocality,
    address?.addressRegion,
    country,
  ].filter((part): part is string => Boolean(part));
  return {
    ...(parts.length > 0 ? { location: [...new Set(parts)].join(', ') } : {}),
    ...(country ? { country } : {}),
    ...(address?.addressLocality ? { city: address.addressLocality } : {}),
  };
};

const remoteRegions = (posting: JobPosting): string[] => {
  if (!posting.applicantLocationRequirements) return [];
  const requirements = Array.isArray(posting.applicantLocationRequirements)
    ? posting.applicantLocationRequirements
    : [posting.applicantLocationRequirements];
  return requirements
    .map(({ name }) => name?.trim())
    .filter((name): name is string => Boolean(name));
};

const workMode = (
  posting: JobPosting,
  description: string,
  hasLocation: boolean,
): NormalizedJob['workMode'] => {
  if (/TELECOMMUTE/iu.test(posting.jobLocationType ?? '')) return 'REMOTE';
  if (
    /\b(?:hybrid|remote after|home[ -]?office|kombinovan|částečně remote|po zkušební době remote|remote po zkušební době)\b/iu.test(
      description,
    )
  )
    return 'HYBRID';
  if (/\b(?:remote|worldwide|anywhere|práce odkudkoliv)\b/iu.test(description))
    return 'REMOTE';
  return hasLocation ? 'ONSITE' : 'UNKNOWN';
};

const salary = (posting: JobPosting) => {
  const value = posting.baseSalary?.value;
  if (typeof value === 'number')
    return {
      salaryMin: Math.round(value),
      salaryMax: Math.round(value),
      ...(posting.baseSalary?.currency
        ? { salaryCurrency: posting.baseSalary.currency }
        : {}),
    };
  if (!value) return {};
  const minimum = value.minValue ?? value.value;
  const maximum = value.maxValue ?? value.value;
  return {
    ...(minimum === undefined ? {} : { salaryMin: Math.round(minimum) }),
    ...(maximum === undefined ? {} : { salaryMax: Math.round(maximum) }),
    ...(posting.baseSalary?.currency
      ? { salaryCurrency: posting.baseSalary.currency }
      : {}),
    ...(value.unitText ? { salaryPeriod: value.unitText } : {}),
  };
};

export const parseStartupJobsPage = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob => {
  const posting = extractJobPosting(html);
  const description = cleanHtml(posting.description);
  const location = locationDetails(posting);
  const regions = remoteRegions(posting);
  const originalUrl = canonicalizeUrl(posting.url);
  const employmentType = Array.isArray(posting.employmentType)
    ? posting.employmentType.join(', ')
    : posting.employmentType;
  return normalizedJobSchema.parse({
    externalId: identifier(posting, listing.externalId),
    sourceId,
    title: posting.title,
    company: posting.hiringOrganization.name,
    description,
    shortDescription: description.slice(0, 500),
    ...location,
    workMode: workMode(posting, description, Boolean(location.location)),
    remoteRegions: regions,
    ...salary(posting),
    ...(employmentType ? { contractType: employmentType } : {}),
    technologyStack: extractTechnologyStack(`${posting.title} ${description}`),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(optionalDate(posting.datePosted)
      ? { publishedAt: optionalDate(posting.datePosted) }
      : {}),
    raw: posting,
  });
};

const wait = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new Error('StartupJobs detail request was aborted'),
        );
      },
      { once: true },
    );
  });

export const createStartupJobsCzAdapter = (input?: {
  minimumDetailIntervalMs?: number;
}): JobSourceAdapter => {
  const minimumDetailIntervalMs = input?.minimumDetailIntervalMs ?? 2_000;
  let lastDetailStartedAt = 0;
  return {
    id: sourceId,
    name: 'StartupJobs.cz',
    baseUrl: 'https://www.startupjobs.cz',
    strategy: 'SITEMAP',
    attribution: 'Jobs by StartupJobs.cz',
    fetchIntervalMinutes: 240,
    rateLimitPerMinute: 30,
    discover: async ({ checkpoint, signal }) => {
      const response = await fetchJobSource(sitemapUrl, {
        accept: 'application/xml, text/xml',
        ...(checkpoint ? { checkpoint } : {}),
        ...(signal ? { signal } : {}),
      });
      if (response.status === 304)
        return {
          jobs: [],
          notModified: true,
          ...(checkpoint ? { checkpoint } : {}),
        };
      return {
        jobs: parseStartupJobsSitemap(await response.text()),
        checkpoint: responseCheckpoint(response),
      };
    },
    fetchDetail: async (job, { signal }) => {
      const remaining =
        lastDetailStartedAt + minimumDetailIntervalMs - Date.now();
      if (remaining > 0) await wait(remaining, signal);
      lastDetailStartedAt = Date.now();
      const response = await fetchJobSource(job.originalUrl, {
        accept: 'text/html,application/xhtml+xml',
        ...(signal ? { signal } : {}),
      });
      return parseStartupJobsPage(await response.text(), job);
    },
  };
};
