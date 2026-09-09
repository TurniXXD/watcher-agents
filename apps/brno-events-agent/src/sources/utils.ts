import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import { z } from 'zod';
import { inferCategories } from '../domain/categorization.js';
import { canonicalUrl } from '../domain/normalization.js';
import {
  rawEventSchema,
  type EventCategory,
  type RawEvent,
} from '../domain/types.js';

export const sourceUserAgent = 'Watcher Brno Events Agent/1.0';

export const fetchSource = async (
  url: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Response> => {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetcher(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      accept:
        'text/html,application/xhtml+xml,application/json,application/rss+xml',
      'user-agent': sourceUserAgent,
    },
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response;
};

export const cleanText = (value?: string | null): string | undefined => {
  const cleaned = value?.replace(/\s+/gu, ' ').trim();
  return cleaned || undefined;
};

export const dateValue = (value: unknown): Date | undefined => {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export const absoluteUrl = (
  value: string | undefined,
  pageUrl: string,
): string | undefined => {
  if (!value) return undefined;
  try {
    return canonicalUrl(new URL(value, pageUrl).toString());
  } catch {
    return undefined;
  }
};

export const eventCandidate = (input: {
  externalId?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  startAt?: Date | undefined;
  endAt?: Date | undefined;
  eventUrl?: string | undefined;
  venue?:
    { name?: string | undefined; address?: string | undefined } | undefined;
  organizer?:
    { name?: string | undefined; url?: string | undefined } | undefined;
  language?: 'cs' | 'en' | 'other' | undefined;
  imageUrl?: string | undefined;
  registrationUrl?: string | undefined;
  categories: EventCategory[];
  raw?: unknown;
}): RawEvent | undefined => {
  if (!input.title || !input.startAt || !input.eventUrl) return undefined;
  const parsed = rawEventSchema.safeParse({
    ...input,
    categories: inferCategories(
      `${input.title} ${input.description ?? ''}`,
      input.categories,
    ),
  });
  return parsed.success ? parsed.data : undefined;
};

export const upcoming = (events: RawEvent[], now: Date): RawEvent[] => {
  const seen = new Set<string>();
  return events.filter((event) => {
    if ((event.endAt ?? event.startAt) < now) return false;
    const key = `${event.externalId ?? event.eventUrl}|${event.startAt.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const htmlDocument = (html: string): CheerioAPI => load(html);

const englishMonths: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export const parseEnglishDateRange = (
  value: string,
  now: Date,
): { start: Date; end?: Date } | undefined => {
  const text = cleanText(value)?.toLowerCase().replace(/[–—]/gu, '-') ?? '';
  const fullRange = text.match(
    /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?\s*-\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?$/u,
  );
  if (fullRange) {
    const startMonth = englishMonths[fullRange[2]!];
    const endMonth = englishMonths[fullRange[8]!];
    if (startMonth === undefined || endMonth === undefined) return undefined;
    const endYear = Number(fullRange[9] ?? fullRange[3] ?? now.getFullYear());
    let startYear = Number(fullRange[3] ?? endYear);
    if (startMonth > endMonth && !fullRange[3]) startYear = endYear - 1;
    const hour = (
      raw: string | undefined,
      period: string | undefined,
    ): number => {
      const parsed = Number(raw ?? 0) % 12;
      return period === 'pm' ? parsed + 12 : parsed;
    };
    return {
      start: new Date(
        startYear,
        startMonth,
        Number(fullRange[1]),
        hour(fullRange[4], fullRange[6]),
        Number(fullRange[5] ?? 0),
      ),
      end: new Date(
        endYear,
        endMonth,
        Number(fullRange[7]),
        fullRange[10] ? hour(fullRange[10], fullRange[12]) : 23,
        fullRange[10] ? Number(fullRange[11] ?? 0) : 59,
        fullRange[10] ? 0 : 59,
        fullRange[10] ? 0 : 999,
      ),
    };
  }
  const compactRange = text.match(
    /^(\d{1,2})\s*-\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/u,
  );
  if (compactRange) {
    const month = englishMonths[compactRange[3]!];
    if (month === undefined) return undefined;
    const year = Number(compactRange[4] ?? now.getFullYear());
    return {
      start: new Date(year, month, Number(compactRange[1])),
      end: new Date(year, month, Number(compactRange[2]), 23, 59, 59, 999),
    };
  }
  const single = text.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/u);
  if (!single) return undefined;
  const month = englishMonths[single[2]!];
  if (month === undefined) return undefined;
  let year = Number(single[3] ?? now.getFullYear());
  let start = new Date(year, month, Number(single[1]));
  if (!single[3] && start.getTime() < now.getTime() - 31 * 86_400_000) {
    year += 1;
    start = new Date(year, month, Number(single[1]));
  }
  return { start };
};

export const embeddedJson = ($: CheerioAPI, selector: string): unknown[] =>
  $(selector)
    .toArray()
    .flatMap((element) => {
      try {
        return [z.unknown().parse(JSON.parse($(element).text()))];
      } catch {
        return [];
      }
    });

export const walkObjects = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap(walkObjects);
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return [];
  return [parsed.data, ...Object.values(parsed.data).flatMap(walkObjects)];
};
