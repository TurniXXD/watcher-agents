import { afterEach, describe, expect, it, vi } from 'vitest';
import { CeitecEventSource, parseCeitecResponse } from '../sources/ceitec.js';
import { JsonLdEventSource, parseJsonLdEvents } from '../sources/json-ld.js';
import { PaginatedHtmlEventSource } from '../sources/html-source.js';
import { parseMeetupHtml } from '../sources/meetup.js';
import { createSources, type SourceSettings } from '../sources/registry.js';
import {
  parseGoOutHtml,
  parseJicHtml,
  parseMuniHtml,
  parseVisitBrnoHtml,
  parseVutHtml,
} from '../sources/site-html.js';

afterEach(() => {
  vi.useRealTimers();
});

const now = new Date('2026-09-08T00:00:00Z');
const pageUrl = 'https://events.example.test/list';
const parse = (
  parser: typeof parseGoOutHtml,
  html: string,
  categories: Parameters<typeof parser>[3] = ['other'],
) => parser(html, pageUrl, now, categories);
const settings = Object.fromEntries(
  ['meetup', 'goout', 'visitbrno', 'muni', 'vut', 'jic', 'ceitec'].map((id) => [
    id,
    { interval: 60, enabled: true },
  ]),
) as SourceSettings;

describe('Brno event sources', () => {
  it('registers every source with independent polling configuration', () => {
    expect(createSources(settings).map((source) => source.id)).toEqual([
      'meetup',
      'goout',
      'visitbrno',
      'muni',
      'vut',
      'jic',
      'ceitec',
    ]);
  });

  it('keeps schema.org Event as a shared fallback', () => {
    const events = parseJsonLdEvents(
      `<script type="application/ld+json">{"@type":"Event","@id":"fixture","name":"AI workshop","startDate":"2026-09-10T18:00:00+02:00","url":"/event"}</script>`,
      pageUrl,
    );
    expect(events[0]).toMatchObject({
      externalId: 'fixture',
      title: 'AI workshop',
      eventUrl: 'https://events.example.test/event',
    });
  });

  it('parses Meetup Next.js data without JSON-LD', () => {
    const events = parse(
      parseMeetupHtml,
      `<script id="__NEXT_DATA__" type="application/json">{"props":{"eventsInLocation":[{"__typename":"Event","id":"316","title":"Brno TypeScript","eventUrl":"/events/316","dateTime":"2026-09-10T18:00:00+02:00","endTime":"2026-09-10T20:00:00+02:00","venue":{"name":"Impact Hub","city":"Brno"},"group":{"name":"Frontendisti"}}]}}</script>`,
      ['networking'],
    );
    expect(events[0]).toMatchObject({
      externalId: '316',
      title: 'Brno TypeScript',
      venue: { name: 'Impact Hub', address: 'Brno' },
    });
  });

  it('parses GoOut event cards without JSON-LD', () => {
    const events = parse(
      parseGoOutHtml,
      `<div class="schedule-box"><div class="info"><a class="title" href="/en/concert/x/" title="Concert">Concert</a><span><time datetime="2026-09-11T18:00:00.000Z">20:00</time></span><a class="text-truncate">Kabinet MÚZ</a></div></div>`,
      ['culture'],
    );
    expect(events[0]).toMatchObject({
      title: 'Concert',
      eventUrl: 'https://events.example.test/en/concert/x',
      venue: { name: 'Kabinet MÚZ' },
    });
  });

  it('parses VisitBrno cards and English date ranges', () => {
    const events = parse(
      parseVisitBrnoHtml,
      `<li class="c-grid__item"><a class="b-image" href="/events/festival"><img src="/festival.jpg"><h3 class="b-image__title">Festival</h3><p class="b-image__desc">10–12 september 2026</p></a></li>`,
      ['culture'],
    );
    expect(events[0]?.startAt.getDate()).toBe(10);
    expect(events[0]?.endAt?.getDate()).toBe(12);
  });

  it('follows bounded provider pagination and deduplicates repeated events', async () => {
    const page = (title: string, next?: string) =>
      `<li class="c-grid__item"><a class="b-image" href="/events/${title.toLowerCase()}"><h3 class="b-image__title">${title}</h3><p class="b-image__desc">10 september 2026</p></a></li>${next ? `<a id="next" href="${next}">Next</a>` : ''}`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(page('First', '/page-2')))
      .mockResolvedValueOnce(new Response(page('Second')));
    const source = new PaginatedHtmlEventSource(
      'visitbrno',
      'VisitBrno',
      pageUrl,
      360,
      true,
      ['culture'],
      parseVisitBrnoHtml,
      '#next',
      10,
      fetcher,
    );
    const events = await source.fetchUpcomingEvents({ now });
    expect(events.map((event) => event.title)).toEqual(['First', 'Second']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('parses MUNI cards without JSON-LD', () => {
    const events = parse(
      parseMuniHtml,
      `<article class="box-event"><a class="box-event__inner" href="/event"><div class="box-event__content"><h4 class="box-event__title">Research Night<span>external</span></h4><p class="box-event__date">9 Sep 6:00 PM – 10 Sep 8:00 PM</p><p>Open laboratories.</p></div></a></article>`,
      ['university'],
    );
    expect(events[0]).toMatchObject({
      title: 'Research Night',
      description: 'Open laboratories.',
    });
    expect(events[0]?.startAt.getHours()).toBe(18);
  });

  it('parses VUT server-rendered calendar entries', () => {
    const events = parse(
      parseVutHtml,
      `<li class="c-events__item"><a class="c-events__term" href="/event" title="Academic Assembly"><time datetime="2026-09-17"></time><h2 class="b-term__title">Academic Assembly</h2></a></li>`,
      ['university'],
    );
    expect(events[0]?.title).toBe('Academic Assembly');
  });

  it('parses JIC cards with Czech date and time', () => {
    const events = parse(
      parseJicHtml,
      `<div class="event-container"><div class="article-item"><a class="article-item-link" href="/cz/workshop"><div class="article-item-title">AI workshop</div><div class="datetimeplace-box"><span>11. 9. 2026</span><span>09.00–12.00</span><span>JIC Startup Hub, Brno</span></div><div class="article-item-perex">Pro founders.</div></a></div></div>`,
      ['startup'],
    );
    expect(events[0]).toMatchObject({
      title: 'AI workshop',
      language: 'cs',
      venue: { name: 'JIC Startup Hub, Brno' },
    });
    expect(events[0]?.startAt.getHours()).toBe(9);
  });

  it('validates and normalizes the CEITEC public API', () => {
    const events = parseCeitecResponse(
      {
        data: [
          {
            id: 5579,
            title_en: 'Molecular diagnostics school',
            perex: 'Five-day summer school.',
            date_from: '2026-09-10T08:00:00.000Z',
            date_to: '2026-09-11T15:00:00.000Z',
            place: 'CEITEC MUNI, Brno',
            organizer: 'CEITEC MUNI',
          },
        ],
      },
      'https://www.ceitec.eu/events/',
      ['science'],
    );
    expect(events[0]).toMatchObject({
      externalId: '5579',
      title: 'Molecular diagnostics school',
      eventUrl: 'https://www.ceitec.eu/molecular-diagnostics-school/a5579',
    });
  });

  it('falls back to CEITEC JSON-LD when its API is unavailable', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          `<script type="application/ld+json">{"@type":"Event","name":"CEITEC lecture","startDate":"2026-09-12T10:00:00+02:00","url":"/lecture"}</script>`,
        ),
      );
    const source = new CeitecEventSource(
      'ceitec',
      'CEITEC',
      'https://www.ceitec.eu/events/',
      720,
      true,
      ['science'],
      fetcher,
    );
    const assertion = expect(
      source.fetchUpcomingEvents({ now }),
    ).resolves.toHaveLength(1);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not invent events from malformed structured data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('<script type="application/ld+json">{broken</script>'),
      );
    const source = new JsonLdEventSource(
      'malformed',
      'Malformed fixture',
      'https://malformed.example.test',
      60,
      true,
      ['other'],
      fetcher,
    );
    await expect(source.fetchUpcomingEvents()).resolves.toEqual([]);
  });
});
