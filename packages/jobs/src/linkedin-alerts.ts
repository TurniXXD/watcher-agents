import { load } from 'cheerio';
import { z } from 'zod';
import { extractTechnologyStack } from './normalization.js';
import { normalizedJobSchema, type JobSourceAdapter } from './types.js';

export const linkedinAlertMessageSchema = z.object({
  from: z.email(),
  subject: z.string(),
  html: z.string().max(1_000_000),
  receivedAt: z.date(),
});

export type LinkedinAlertMessage = z.infer<typeof linkedinAlertMessageSchema>;

const isLinkedinSender = (address: string): boolean =>
  address.toLowerCase().endsWith('@linkedin.com');

const linkedinJobId = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (!['linkedin.com', 'www.linkedin.com'].includes(url.hostname))
      return undefined;
    return (
      url.pathname.match(/\/(?:comm\/)?jobs\/view\/(\d+)/u)?.[1] ??
      url.searchParams.get('currentJobId')?.match(/^\d+$/u)?.[0]
    );
  } catch {
    return undefined;
  }
};

const meaningful = (value: string): boolean =>
  Boolean(value) &&
  !/^(?:view|see|apply|open|jobs?|see all jobs|view job|view details)$/iu.test(
    value,
  );

const cardLines = (html: string): string[] =>
  html
    .replace(/<\/(?:p|div|tr|td|h[1-6]|li|a|span)>/giu, '\n')
    .split(/\n+/u)
    .map((part) => load(part).text().replace(/\s+/gu, ' ').trim())
    .filter(Boolean);

const countryHint = (location: string): string | undefined =>
  /\b(?:czechia|czech republic|česká republika|česko|praha|prague|brno|ostrava|plzeň|pilsen)\b/iu.test(
    location,
  )
    ? 'Czechia'
    : undefined;

export const parseLinkedinAlert = (input: LinkedinAlertMessage) => {
  const message = linkedinAlertMessageSchema.parse(input);
  if (!isLinkedinSender(message.from)) return [];
  const $ = load(message.html);
  const jobs = new Map<string, z.infer<typeof normalizedJobSchema>>();
  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const id = linkedinJobId(anchor.attr('href') ?? '');
    if (!id || jobs.has(id)) return;
    const title = anchor.text().replace(/\s+/gu, ' ').trim();
    if (!meaningful(title) || title.length > 200) return;
    let card = anchor.parent();
    for (let depth = 0; depth < 5; depth += 1) {
      const lines = cardLines(card.html() ?? '');
      const links = card
        .find('a[href]')
        .toArray()
        .filter((link) => linkedinJobId($(link).attr('href') ?? ''));
      if (lines.length >= 3 && links.length === 1) break;
      const parent = card.parent();
      if (!parent.length || parent.is('body') || parent.is('html')) break;
      card = parent;
    }
    const lines = cardLines(card.html() ?? '').filter(
      (line) => !/^(?:view job|apply now|view details)$/iu.test(line),
    );
    const titleIndex = lines.findIndex((line) => line === title);
    if (titleIndex < 0) return;
    const company = lines[titleIndex + 1];
    const location = lines[titleIndex + 2];
    if (!company || !meaningful(company) || company.length > 150) return;
    const description = lines.slice(titleIndex + 1, titleIndex + 5).join(' · ');
    const url = `https://www.linkedin.com/jobs/view/${id}/`;
    const parsed = normalizedJobSchema.safeParse({
      externalId: id,
      sourceId: 'linkedin',
      title,
      company,
      description,
      shortDescription: description.slice(0, 500),
      ...(location ? { location } : {}),
      ...(location && countryHint(location)
        ? { country: countryHint(location) }
        : {}),
      workMode: /\bremote\b/iu.test(location ?? '')
        ? 'REMOTE'
        : /\bhybrid\b/iu.test(location ?? '')
          ? 'HYBRID'
          : location
            ? 'ONSITE'
            : 'UNKNOWN',
      remoteRegions: [],
      technologyStack: extractTechnologyStack(`${title} ${description}`),
      originalUrl: url,
      canonicalApplicationUrl: url,
      publishedAt: message.receivedAt,
      raw: { channel: 'linkedin-job-alert-email', partialEvidence: true },
    });
    if (parsed.success) jobs.set(id, parsed.data);
  });
  return [...jobs.values()];
};

export const createLinkedinAlertAdapter = (
  readMessages: () => Promise<LinkedinAlertMessage[]>,
): JobSourceAdapter => ({
  id: 'linkedin',
  name: 'LinkedIn Jobs (email alerts)',
  baseUrl: 'https://www.linkedin.com/jobs',
  strategy: 'EMAIL',
  attribution: 'Job alerts delivered by LinkedIn to the operator mailbox',
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 1,
  discover: async () => ({
    jobs: (await readMessages()).flatMap(parseLinkedinAlert),
  }),
});
