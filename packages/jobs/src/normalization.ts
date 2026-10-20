import { createHash } from 'node:crypto';

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
]);

export const normalizeText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

export const cleanHtml = (value: string): string =>
  value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/\s+/gu, ' ')
    .trim();

export const canonicalizeUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString();
};

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const jobContentHash = (input: {
  title: string;
  company: string;
  description: string;
  location?: string;
  applicationUrl?: string;
}): string =>
  sha256(
    JSON.stringify({
      title: normalizeText(input.title),
      company: normalizeText(input.company),
      description: normalizeText(input.description),
      location: normalizeText(input.location ?? ''),
      applicationUrl: input.applicationUrl
        ? canonicalizeUrl(input.applicationUrl)
        : '',
    }),
  );

export const jobFingerprint = (input: {
  title: string;
  company: string;
  location?: string;
  applicationUrl?: string;
}): string =>
  input.applicationUrl
    ? sha256(`application:${canonicalizeUrl(input.applicationUrl)}`)
    : sha256(
        [input.company, input.title, input.location ?? '']
          .map(normalizeText)
          .join('|'),
      );

const technologies = [
  'TypeScript',
  'JavaScript',
  'React',
  'Next.js',
  'Node.js',
  'PostgreSQL',
  'Prisma',
  'Docker',
  'AWS',
  'Git',
  'REST',
  'GraphQL',
  'Python',
  'Java',
  'C#',
  '.NET',
  'Kubernetes',
  'Vue',
  'Angular',
] as const;

export const extractTechnologyStack = (value: string): string[] => {
  const normalized = normalizeText(value);
  return technologies.filter((technology) =>
    normalized.includes(normalizeText(technology)),
  );
};
