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

const optionalDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const arbeitnowJobSchema = z.object({
  slug: z.string().trim().min(1),
  company_name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().default(''),
  remote: z.boolean(),
  url: z.url(),
  tags: z.array(z.string()).default([]),
  job_types: z.array(z.string()).default([]),
  location: z.string().trim().optional(),
  created_at: z.number().int().nonnegative().optional(),
});

const arbeitnowResponseSchema = z.object({
  data: z.array(arbeitnowJobSchema),
});

export const parseArbeitnowJob = (value: unknown): NormalizedJob => {
  const item = arbeitnowJobSchema.parse(value);
  const description = cleanHtml(item.description);
  const originalUrl = canonicalizeUrl(item.url);
  const hybrid = /\bhybrid\b/iu.test(`${item.location ?? ''} ${description}`);
  return normalizedJobSchema.parse({
    externalId: item.slug,
    sourceId: 'arbeitnow',
    title: item.title,
    company: item.company_name,
    description,
    shortDescription: description.slice(0, 500),
    ...(item.location ? { location: item.location } : {}),
    workMode: item.remote ? 'REMOTE' : hybrid ? 'HYBRID' : 'ONSITE',
    remoteRegions: [],
    ...(item.job_types.length
      ? { contractType: item.job_types.join(', ') }
      : {}),
    technologyStack: extractTechnologyStack(
      `${item.title} ${item.tags.join(' ')} ${description}`,
    ),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(item.created_at
      ? { publishedAt: new Date(item.created_at * 1_000) }
      : {}),
    raw: item,
  });
};

export const createArbeitnowAdapter = (): JobSourceAdapter => ({
  id: 'arbeitnow',
  name: 'Arbeitnow',
  baseUrl: 'https://www.arbeitnow.com',
  strategy: 'API',
  attribution: 'Jobs by Arbeitnow',
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 15,
  discover: async ({ checkpoint, signal }) => {
    const response = await fetchJobSource(
      'https://www.arbeitnow.com/api/job-board-api?page=1',
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
    const payload = arbeitnowResponseSchema.parse(await response.json());
    return {
      jobs: payload.data.map(parseArbeitnowJob),
      checkpoint: responseCheckpoint(response),
    };
  },
});

const nullableNumber = z.number().finite().nonnegative().nullish();

const jobicyJobSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  url: z.url(),
  jobTitle: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  jobIndustry: z.array(z.string()).default([]),
  jobType: z.array(z.string()).default([]),
  jobGeo: z.string().trim().min(1),
  jobLevel: z.string().trim().nullish(),
  jobExcerpt: z.string().default(''),
  jobDescription: z.string().default(''),
  pubDate: z.string().optional(),
  salaryMin: nullableNumber,
  salaryMax: nullableNumber,
  salaryCurrency: z.string().trim().nullish(),
  salaryPeriod: z.string().trim().nullish(),
});

const jobicyResponseSchema = z.object({
  jobs: z.array(jobicyJobSchema),
  success: z.boolean().optional(),
});

const jobicyStatusResponseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
      status: z.enum(['active', 'closed', 'unknown']),
    }),
  ),
  success: z.boolean().optional(),
});

export const parseJobicyJob = (value: unknown): NormalizedJob => {
  const item = jobicyJobSchema.parse(value);
  const description = cleanHtml(item.jobDescription || item.jobExcerpt);
  const originalUrl = canonicalizeUrl(item.url);
  const region = /^anywhere$/iu.test(item.jobGeo) ? 'Worldwide' : item.jobGeo;
  return normalizedJobSchema.parse({
    externalId: String(item.id),
    sourceId: 'jobicy',
    title: item.jobTitle,
    company: item.companyName,
    description,
    shortDescription: cleanHtml(item.jobExcerpt).slice(0, 500),
    location: item.jobGeo,
    workMode: 'REMOTE',
    remoteRegions: [region],
    ...(item.salaryMin == null
      ? {}
      : { salaryMin: Math.round(item.salaryMin) }),
    ...(item.salaryMax == null
      ? {}
      : { salaryMax: Math.round(item.salaryMax) }),
    ...(item.salaryCurrency ? { salaryCurrency: item.salaryCurrency } : {}),
    ...(item.salaryPeriod ? { salaryPeriod: item.salaryPeriod } : {}),
    ...(item.jobType.length ? { contractType: item.jobType.join(', ') } : {}),
    ...(item.jobLevel ? { seniority: item.jobLevel } : {}),
    technologyStack: extractTechnologyStack(
      `${item.jobTitle} ${item.jobIndustry.join(' ')} ${description}`,
    ),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(optionalDate(item.pubDate)
      ? { publishedAt: optionalDate(item.pubDate) }
      : {}),
    raw: item,
  });
};

const chunks = <T>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    result.push(values.slice(offset, offset + size));
  return result;
};

const activeJobicyIds = async (
  ids: string[],
  signal?: AbortSignal,
): Promise<Set<string>> => {
  const active = new Set<string>();
  for (const batch of chunks(ids, 100)) {
    const url = new URL('https://jobicy.com/api/v2/remote-jobs/status');
    url.searchParams.set('ids', batch.join(','));
    const response = await fetchJobSource(url.toString(), {
      accept: 'application/json',
      ...(signal ? { signal } : {}),
    });
    const payload = jobicyStatusResponseSchema.parse(await response.json());
    if (payload.success === false)
      throw new Error('Jobicy status endpoint reported failure');
    for (const job of payload.jobs)
      if (job.status === 'active') active.add(String(job.id));
  }
  return active;
};

export const createJobicyAdapter = (): JobSourceAdapter => ({
  id: 'jobicy',
  name: 'Jobicy',
  baseUrl: 'https://jobicy.com',
  strategy: 'API',
  attribution: 'Remote jobs by Jobicy',
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 15,
  discover: async ({ checkpoint, signal }) => {
    const response = await fetchJobSource(
      'https://jobicy.com/api/v2/remote-jobs?count=200&industry=engineering',
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
    const payload = jobicyResponseSchema.parse(await response.json());
    if (payload.success === false)
      throw new Error('Jobicy jobs endpoint reported failure');
    const activeIds = await activeJobicyIds(
      payload.jobs.map((job) => String(job.id)),
      signal,
    );
    return {
      jobs: payload.jobs
        .filter((job) => activeIds.has(String(job.id)))
        .map(parseJobicyJob),
      checkpoint: responseCheckpoint(response),
    };
  },
});
