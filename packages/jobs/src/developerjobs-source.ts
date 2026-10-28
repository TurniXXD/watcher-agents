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

const sourceId = 'developerjobs-ch';
const rssUrl = 'https://developerjobs.ch/en/rss.xml';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

const rssItemSchema = z.object({
  title: z.string().trim().min(1),
  link: z.url(),
  guid: z.union([z.string(), z.object({ '#text': z.string() })]).optional(),
  pubDate: z.string().optional(),
  description: z.string().default(''),
});

const rssSchema = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([rssItemSchema, z.array(rssItemSchema)]).optional(),
    }),
  }),
});

const optionalDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const listingIdentity = (url: string): string => {
  const match = new URL(url).pathname.match(
    /^\/en\/jobs\/([0-9a-f-]{20,})\/?$/iu,
  );
  return match?.[1] ?? url;
};

export const parseDeveloperJobsRss = (xml: string): NormalizedJob[] => {
  const document = rssSchema.parse(xmlParser.parse(xml));
  const rawItems = document.rss.channel.item;
  const items = rawItems
    ? Array.isArray(rawItems)
      ? rawItems
      : [rawItems]
    : [];
  return items.map((item) => {
    const [titlePart, companyPart] = item.title.split(/\s+·\s+/u, 2);
    const title = titlePart?.trim() || item.title;
    const company = companyPart?.trim() || 'Unknown company';
    const description = cleanHtml(item.description);
    const originalUrl = canonicalizeUrl(item.link);
    return normalizedJobSchema.parse({
      externalId: listingIdentity(originalUrl),
      sourceId,
      title,
      company,
      description,
      shortDescription: description.slice(0, 500),
      workMode: 'UNKNOWN',
      remoteRegions: [],
      technologyStack: extractTechnologyStack(`${title} ${description}`),
      originalUrl,
      canonicalApplicationUrl: originalUrl,
      ...(optionalDate(item.pubDate)
        ? { publishedAt: optionalDate(item.pubDate) }
        : {}),
      raw: item,
    });
  });
};

const addressSchema = z
  .object({
    addressLocality: z.string().optional(),
    addressRegion: z.string().optional(),
    addressCountry: z.string().optional(),
  })
  .passthrough();

const jobPostingSchema = z
  .object({
    '@type': z.literal('JobPosting'),
    title: z.string().trim().min(1),
    description: z.string().default(''),
    datePosted: z.string().optional(),
    validThrough: z.string().optional(),
    employmentType: z.union([z.string(), z.array(z.string())]).optional(),
    url: z.url(),
    hiringOrganization: z.object({ name: z.string().trim().min(1) }),
    jobLocation: z
      .union([
        z.object({ address: addressSchema.optional() }),
        z.array(z.object({ address: addressSchema.optional() })),
      ])
      .optional(),
  })
  .passthrough();

type JobPosting = z.infer<typeof jobPostingSchema>;

const extractJobPosting = (html: string): JobPosting => {
  for (const match of html.matchAll(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    try {
      const parsed = jobPostingSchema.safeParse(JSON.parse(match[1] ?? ''));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }
  throw new Error(
    'DeveloperJobs page does not contain valid JobPosting JSON-LD',
  );
};

const locationDetails = (posting: JobPosting) => {
  const locations = !posting.jobLocation
    ? []
    : Array.isArray(posting.jobLocation)
      ? posting.jobLocation
      : [posting.jobLocation];
  const address = locations[0]?.address;
  const parts = [
    address?.addressLocality,
    address?.addressRegion,
    address?.addressCountry,
  ].filter((part): part is string => Boolean(part));
  return {
    ...(parts.length ? { location: [...new Set(parts)].join(', ') } : {}),
    ...(address?.addressCountry ? { country: address.addressCountry } : {}),
    ...(address?.addressLocality ? { city: address.addressLocality } : {}),
  };
};

export const parseDeveloperJobsPage = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob => {
  const posting = extractJobPosting(html);
  const description = cleanHtml(posting.description);
  const location = locationDetails(posting);
  const employmentType = Array.isArray(posting.employmentType)
    ? posting.employmentType.join(', ')
    : posting.employmentType;
  const originalUrl = canonicalizeUrl(posting.url);
  const hybrid = /\bhybrid\b/iu.test(description);
  const remote = /\b(?:remote|worldwide|anywhere|telecommut)\b/iu.test(
    description,
  );
  return normalizedJobSchema.parse({
    externalId: listingIdentity(originalUrl) || listing.externalId,
    sourceId,
    title: posting.title,
    company: posting.hiringOrganization.name,
    description,
    shortDescription: description.slice(0, 500),
    ...location,
    workMode: hybrid
      ? 'HYBRID'
      : remote
        ? 'REMOTE'
        : location.location
          ? 'ONSITE'
          : 'UNKNOWN',
    remoteRegions: [],
    ...(employmentType ? { contractType: employmentType } : {}),
    technologyStack: extractTechnologyStack(`${posting.title} ${description}`),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(optionalDate(posting.datePosted)
      ? { publishedAt: optionalDate(posting.datePosted) }
      : listing.publishedAt
        ? { publishedAt: listing.publishedAt }
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
        reject(reason instanceof Error ? reason : new Error('Request aborted'));
      },
      { once: true },
    );
  });

export const createDeveloperJobsAdapter = (input?: {
  minimumDetailIntervalMs?: number;
}): JobSourceAdapter => {
  const minimumDetailIntervalMs = input?.minimumDetailIntervalMs ?? 1_000;
  let lastDetailStartedAt = 0;
  return {
    id: sourceId,
    name: 'DeveloperJobs.ch',
    baseUrl: 'https://developerjobs.ch',
    strategy: 'RSS',
    attribution: 'Jobs by DeveloperJobs.ch',
    fetchIntervalMinutes: 240,
    rateLimitPerMinute: 60,
    discover: async ({ checkpoint, signal }) => {
      const response = await fetchJobSource(rssUrl, {
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
      return {
        jobs: parseDeveloperJobsRss(await response.text()),
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
      return parseDeveloperJobsPage(await response.text(), job);
    },
  };
};
