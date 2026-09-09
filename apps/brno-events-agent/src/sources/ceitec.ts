import { load } from 'cheerio';
import { z } from 'zod';
import type { EventCategory, EventSource, RawEvent } from '../domain/types.js';
import { parseJsonLdEvents } from './json-ld.js';
import {
  absoluteUrl,
  dateValue,
  eventCandidate,
  fetchSource,
  upcoming,
} from './utils.js';

const ceitecEventSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  title_en: z.string().nullish(),
  title_cs: z.string().nullish(),
  perex: z.string().nullish(),
  text_en: z.string().nullish(),
  text_cs: z.string().nullish(),
  date_from: z.string(),
  date_to: z.string().nullish(),
  updated: z.string().nullish(),
  place: z.string().nullish(),
  place_en: z.string().nullish(),
  place_cs: z.string().nullish(),
  organizer: z.string().nullish(),
  organizer_institution: z.string().nullish(),
  online_stream_url: z.string().nullish(),
  image_url: z.string().nullish(),
});
const ceitecResponseSchema = z.object({ data: z.array(z.unknown()) });

const plainText = (html?: string | null): string | undefined => {
  if (!html) return undefined;
  const text = load(html).text().replace(/\s+/gu, ' ').trim();
  return text || undefined;
};

const slug = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');

export const parseCeitecResponse = (
  value: unknown,
  pageUrl: string,
  categories: EventCategory[],
): RawEvent[] => {
  const response = ceitecResponseSchema.safeParse(value);
  if (!response.success) return [];
  return response.data.data.flatMap((raw) => {
    const parsed = ceitecEventSchema.safeParse(raw);
    if (!parsed.success) return [];
    const item = parsed.data;
    const title = item.title ?? item.title_en ?? item.title_cs ?? undefined;
    const candidate = eventCandidate({
      externalId: String(item.id),
      title,
      description:
        item.perex ?? plainText(item.text_en) ?? plainText(item.text_cs),
      startAt: dateValue(item.date_from),
      endAt: dateValue(item.date_to),
      eventUrl: title
        ? absoluteUrl(`/${slug(title)}/a${item.id}`, pageUrl)
        : pageUrl,
      venue: {
        name: item.place ?? item.place_en ?? item.place_cs ?? undefined,
      },
      organizer: {
        name: item.organizer ?? item.organizer_institution ?? 'CEITEC',
      },
      registrationUrl: absoluteUrl(
        item.online_stream_url ?? undefined,
        pageUrl,
      ),
      imageUrl: absoluteUrl(item.image_url ?? undefined, pageUrl),
      language: item.title_en ? 'en' : item.title_cs ? 'cs' : undefined,
      categories,
      raw,
    });
    return candidate ? [candidate] : [];
  });
};

export class CeitecEventSource implements EventSource {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly url: string,
    public readonly intervalMinutes: number,
    public readonly enabled: boolean,
    private readonly categories: EventCategory[],
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetchUpcomingEvents(
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<RawEvent[]> {
    const apiUrl = new URL('/api/action/list/', this.url);
    apiUrl.searchParams.set('filter[a.date_from]', 'true');
    apiUrl.searchParams.set('archive', '0');
    apiUrl.searchParams.set('limit', '100');
    const now = options.now ?? new Date();
    try {
      const response = await fetchSource(
        apiUrl.toString(),
        this.fetcher,
        options.signal,
      );
      return upcoming(
        parseCeitecResponse(await response.json(), this.url, this.categories),
        now,
      );
    } catch (apiError) {
      try {
        const page = await fetchSource(this.url, this.fetcher, options.signal);
        return upcoming(
          parseJsonLdEvents(
            await page.text(),
            page.url || this.url,
            this.categories,
          ),
          now,
        );
      } catch {
        throw apiError;
      }
    }
  }
}
