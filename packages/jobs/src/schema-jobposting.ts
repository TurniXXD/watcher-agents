import { load } from 'cheerio';
import { z } from 'zod';
import {
  canonicalizeUrl,
  cleanHtml,
  extractTechnologyStack,
} from './normalization.js';
import { normalizedJobSchema, type NormalizedJob } from './types.js';

const addressCountrySchema = z.union([
  z.string(),
  z.object({ name: z.string().optional() }).passthrough(),
]);

const addressSchema = z
  .object({
    addressLocality: z.string().optional(),
    addressRegion: z.string().optional(),
    addressCountry: addressCountrySchema.optional(),
  })
  .passthrough();

const locationSchema = z
  .object({ address: addressSchema.optional() })
  .passthrough();

const jobPostingSchema = z
  .object({
    '@type': z.union([z.string(), z.array(z.string())]),
    title: z.string().trim().min(1),
    description: z.string().default(''),
    url: z.url().optional(),
    datePosted: z.string().optional(),
    employmentType: z.union([z.string(), z.array(z.string())]).optional(),
    jobLocationType: z.string().optional(),
    identifier: z
      .union([
        z.string(),
        z.number(),
        z.object({ value: z.union([z.string(), z.number()]) }).passthrough(),
      ])
      .optional(),
    hiringOrganization: z
      .object({ name: z.string().trim().min(1) })
      .passthrough(),
    jobLocation: z.union([locationSchema, z.array(locationSchema)]).optional(),
    applicantLocationRequirements: z
      .union([
        z.object({ name: z.string().optional() }).passthrough(),
        z.array(z.object({ name: z.string().optional() }).passthrough()),
      ])
      .optional(),
    baseSalary: z
      .object({
        currency: z.string().optional(),
        value: z
          .union([
            z.number(),
            z
              .object({
                minValue: z.number().optional(),
                maxValue: z.number().optional(),
                value: z.number().optional(),
                unitText: z.string().optional(),
              })
              .passthrough(),
          ])
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type JobPosting = z.infer<typeof jobPostingSchema>;

const isJobPosting = (value: unknown): value is JobPosting => {
  const parsed = jobPostingSchema.safeParse(value);
  if (!parsed.success) return false;
  const types = Array.isArray(parsed.data['@type'])
    ? parsed.data['@type']
    : [parsed.data['@type']];
  return types.includes('JobPosting');
};

const findJobPosting = (value: unknown): JobPosting | undefined => {
  if (isJobPosting(value)) return jobPostingSchema.parse(value);
  if (Array.isArray(value)) {
    const posting = value.find(isJobPosting);
    return posting ? jobPostingSchema.parse(posting) : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const graph = (value as Record<string, unknown>)['@graph'];
  if (!Array.isArray(graph)) return undefined;
  const posting = graph.find(isJobPosting);
  return posting ? jobPostingSchema.parse(posting) : undefined;
};

const extractPosting = (html: string): JobPosting => {
  const $ = load(html);
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const posting = findJobPosting(JSON.parse($(element).text()));
      if (posting) return posting;
    } catch {
      // A page may contain unrelated malformed analytics JSON-LD.
    }
  }
  throw new Error('Page does not contain valid JobPosting JSON-LD');
};

const optionalDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
  const country =
    typeof address?.addressCountry === 'string'
      ? address.addressCountry
      : address?.addressCountry?.name;
  const parts = [address?.addressLocality, address?.addressRegion, country]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());
  return {
    ...(parts.length > 0 ? { location: [...new Set(parts)].join(', ') } : {}),
    ...(country ? { country } : {}),
    ...(address?.addressLocality ? { city: address.addressLocality } : {}),
  };
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

const inferWorkMode = (
  posting: JobPosting,
  description: string,
  hasLocation: boolean,
): NormalizedJob['workMode'] => {
  if (/TELECOMMUTE/iu.test(posting.jobLocationType ?? '')) return 'REMOTE';
  if (
    /\b(?:hybrid|home[ -]?office|kombinovan|částečně remote)\b/iu.test(
      description,
    )
  )
    return 'HYBRID';
  if (/\b(?:remote|worldwide|anywhere|odkudkoliv)\b/iu.test(description))
    return 'REMOTE';
  return hasLocation ? 'ONSITE' : 'UNKNOWN';
};

export const parseSchemaJobPostingPage = (input: {
  html: string;
  listing: NormalizedJob;
  sourceId: string;
}): NormalizedJob => {
  const posting = extractPosting(input.html);
  const description = cleanHtml(posting.description);
  const locations = locationDetails(posting);
  const originalUrl = canonicalizeUrl(posting.url ?? input.listing.originalUrl);
  const requirements = posting.applicantLocationRequirements
    ? Array.isArray(posting.applicantLocationRequirements)
      ? posting.applicantLocationRequirements
      : [posting.applicantLocationRequirements]
    : [];
  const remoteRegions = requirements
    .map(({ name }) => name?.trim())
    .filter((name): name is string => Boolean(name));
  const contractType = Array.isArray(posting.employmentType)
    ? posting.employmentType.join(', ')
    : posting.employmentType;
  const publishedAt = optionalDate(posting.datePosted);
  return normalizedJobSchema.parse({
    externalId: identifier(posting, input.listing.externalId),
    sourceId: input.sourceId,
    title: posting.title,
    company: posting.hiringOrganization.name,
    description,
    shortDescription: description.slice(0, 500),
    ...locations,
    workMode: inferWorkMode(posting, description, Boolean(locations.location)),
    remoteRegions,
    ...salary(posting),
    ...(contractType ? { contractType } : {}),
    technologyStack: extractTechnologyStack(`${posting.title} ${description}`),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(publishedAt ? { publishedAt } : {}),
    raw: posting,
  });
};
