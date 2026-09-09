import type { EventCategory, EventSource, RawEvent } from '../domain/types.js';
import { parseJsonLdEvents } from './json-ld.js';
import { absoluteUrl, fetchSource, htmlDocument, upcoming } from './utils.js';

export type HtmlParser = (
  html: string,
  pageUrl: string,
  now: Date,
  categories: EventCategory[],
) => RawEvent[];

export class HtmlEventSource implements EventSource {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly url: string,
    public readonly intervalMinutes: number,
    public readonly enabled: boolean,
    private readonly categories: EventCategory[],
    private readonly parsers: HtmlParser[],
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetchUpcomingEvents(
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<RawEvent[]> {
    const response = await fetchSource(this.url, this.fetcher, options.signal);
    const html = await response.text();
    const now = options.now ?? new Date();
    const parsed = this.parsers.flatMap((parser) =>
      parser(html, response.url || this.url, now, this.categories),
    );
    parsed.push(
      ...parseJsonLdEvents(html, response.url || this.url, this.categories),
    );
    return upcoming(parsed, now);
  }
}

export class PaginatedHtmlEventSource implements EventSource {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly url: string,
    public readonly intervalMinutes: number,
    public readonly enabled: boolean,
    private readonly categories: EventCategory[],
    private readonly parser: HtmlParser,
    private readonly nextSelector: string,
    private readonly maxPages = 10,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetchUpcomingEvents(
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<RawEvent[]> {
    const now = options.now ?? new Date();
    const events: RawEvent[] = [];
    const visited = new Set<string>();
    let nextUrl: string | undefined = this.url;
    while (nextUrl && visited.size < this.maxPages && !visited.has(nextUrl)) {
      visited.add(nextUrl);
      const response = await fetchSource(nextUrl, this.fetcher, options.signal);
      const pageUrl = response.url || nextUrl;
      const html = await response.text();
      events.push(...this.parser(html, pageUrl, now, this.categories));
      events.push(...parseJsonLdEvents(html, pageUrl, this.categories));
      const href = htmlDocument(html)(this.nextSelector).first().attr('href');
      nextUrl = absoluteUrl(href, pageUrl);
    }
    return upcoming(events, now);
  }
}
