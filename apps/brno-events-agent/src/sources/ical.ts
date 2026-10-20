import type { EventCategory, EventSource, RawEvent } from '../domain/types.js';
import { eventCandidate, fetchSource, upcoming } from './utils.js';

type IcalProperty = {
  params: Record<string, string>;
  value: string;
};

type IcalSourceOptions = {
  categories: EventCategory[];
  filter?: (event: RawEvent) => boolean;
};

const unescapeText = (value: string): string =>
  value
    .replaceAll('\\n', '\n')
    .replaceAll('\\N', '\n')
    .replaceAll('\\,', ',')
    .replaceAll('\\;', ';')
    .replaceAll('\\\\', '\\')
    .trim();

const properties = (block: string): Map<string, IcalProperty[]> => {
  const result = new Map<string, IcalProperty[]>();
  for (const line of block.replaceAll(/\r?\n[ \t]/gu, '').split(/\r?\n/gu)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const [rawName, ...rawParams] = line.slice(0, separator).split(';');
    const name = rawName?.toUpperCase();
    if (!name) continue;
    const params = Object.fromEntries(
      rawParams.flatMap((entry) => {
        const equals = entry.indexOf('=');
        return equals > 0
          ? [[entry.slice(0, equals).toUpperCase(), entry.slice(equals + 1)]]
          : [];
      }),
    );
    const current = result.get(name) ?? [];
    current.push({ params, value: line.slice(separator + 1) });
    result.set(name, current);
  }
  return result;
};

const first = (
  values: Map<string, IcalProperty[]>,
  name: string,
): IcalProperty | undefined => values.get(name)?.[0];

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const basicDateParts = (value: string): DateParts | undefined => {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/u,
  );
  if (!match) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
};

const safeTimezone = (candidate?: string): string => {
  if (!candidate) return 'Europe/Prague';
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'Europe/Prague';
  }
};

const localParts = (date: Date, timezone: string): DateParts => {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(formatted.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

const inTimezone = (parts: DateParts, timezone: string): Date => {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(candidate, timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate = new Date(candidate.getTime() + desired - represented);
  }
  return candidate;
};

const propertyDate = (property?: IcalProperty): Date | undefined => {
  if (!property) return undefined;
  const parts = basicDateParts(property.value);
  if (!parts) return undefined;
  return property.value.endsWith('Z')
    ? new Date(
        Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second,
        ),
      )
    : inTimezone(parts, safeTimezone(property.params.TZID));
};

const ruleValues = (value: string): Record<string, string> =>
  Object.fromEntries(
    value.split(';').flatMap((entry) => {
      const separator = entry.indexOf('=');
      return separator > 0
        ? [
            [
              entry.slice(0, separator).toUpperCase(),
              entry.slice(separator + 1),
            ],
          ]
        : [];
    }),
  );

const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const occurrenceStarts = (
  values: Map<string, IcalProperty[]>,
  now: Date,
): Date[] => {
  const startProperty = first(values, 'DTSTART');
  const start = propertyDate(startProperty);
  if (!start || !startProperty) return [];
  const recurrence = first(values, 'RRULE');
  if (!recurrence) return [start];
  const rule = ruleValues(recurrence.value);
  if (rule.FREQ !== 'WEEKLY') return [start];
  const startParts = basicDateParts(startProperty.value);
  if (!startParts) return [start];
  const timezone = safeTimezone(startProperty.params.TZID);
  const byDay = new Set(
    (rule.BYDAY ?? weekday[start.getDay()] ?? 'MO').split(','),
  );
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1));
  const until = rule.UNTIL
    ? propertyDate({ params: startProperty.params, value: rule.UNTIL })
    : undefined;
  const horizon = new Date(now.getTime() + 366 * 86_400_000);
  const limit = until && until < horizon ? until : horizon;
  const startDay = Date.UTC(
    startParts.year,
    startParts.month - 1,
    startParts.day,
  );
  const approximateOffset = Math.max(
    0,
    Math.floor((now.getTime() - start.getTime()) / 86_400_000) - 8,
  );
  const excluded = new Set(
    (values.get('EXDATE') ?? [])
      .flatMap((property) => property.value.split(','))
      .flatMap((value) => {
        const parsed = propertyDate({
          params: startProperty.params,
          value,
        });
        return parsed ? [parsed.toISOString()] : [];
      }),
  );
  const result: Date[] = [];
  for (
    let offset = approximateOffset;
    offset < approximateOffset + 750;
    offset += 1
  ) {
    const calendarDate = new Date(startDay + offset * 86_400_000);
    const week = Math.floor(offset / 7);
    if (week % interval !== 0) continue;
    if (!byDay.has(weekday[calendarDate.getUTCDay()]!)) continue;
    const occurrence = inTimezone(
      {
        year: calendarDate.getUTCFullYear(),
        month: calendarDate.getUTCMonth() + 1,
        day: calendarDate.getUTCDate(),
        hour: startParts.hour,
        minute: startParts.minute,
        second: startParts.second,
      },
      timezone,
    );
    if (occurrence > limit) break;
    if (occurrence >= now && !excluded.has(occurrence.toISOString()))
      result.push(occurrence);
  }
  return result;
};

const firstHttpUrl = (value: string): string | undefined => {
  const candidate = value
    .match(/https?:\/\/[^\s<>]+/u)?.[0]
    ?.replace(/[),.;]+$/u, '');
  if (!candidate) return undefined;
  try {
    return new URL(candidate).toString();
  } catch {
    return undefined;
  }
};

const explicitlyFree = (value: string): boolean => {
  const normalized = value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return /(?:vstup(?:ne)?(?: je)? (?:zdarma|volny)|bezplatn[ay] vstup|free (?:entry|admission)|admission (?:is )?free)/u.test(
    normalized,
  );
};

export const parseIcalEvents = (
  ical: string,
  sourceUrl: string,
  now: Date,
  options: IcalSourceOptions,
): RawEvent[] => {
  const parsed = new Map<string, RawEvent>();
  for (const match of ical.matchAll(
    /BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/gu,
  )) {
    const values = properties(match[1]!);
    const title = first(values, 'SUMMARY')?.value;
    const uid = first(values, 'UID')?.value;
    const description = unescapeText(first(values, 'DESCRIPTION')?.value ?? '');
    const location = unescapeText(first(values, 'LOCATION')?.value ?? '');
    const url =
      first(values, 'URL')?.value || firstHttpUrl(description) || sourceUrl;
    const registrationRequired = /registr|přihl[aá]š|sign[ -]?up|rsvp/iu.test(
      description,
    );
    const originalStart = propertyDate(first(values, 'DTSTART'));
    const originalEnd = propertyDate(first(values, 'DTEND'));
    if (!title || !uid || !originalStart) continue;
    const duration = Math.max(
      0,
      (originalEnd ?? originalStart).getTime() - originalStart.getTime(),
    );
    for (const startAt of occurrenceStarts(values, now)) {
      const candidate = eventCandidate({
        externalId: `${uid}:${startAt.toISOString()}`,
        title: unescapeText(title),
        description: description || undefined,
        startAt,
        ...(duration > 0
          ? { endAt: new Date(startAt.getTime() + duration) }
          : {}),
        venue: location ? { name: location } : undefined,
        eventUrl: url,
        registrationUrl: registrationRequired
          ? firstHttpUrl(description)
          : undefined,
        registrationRequired,
        language: 'cs',
        price: explicitlyFree(`${title} ${description}`)
          ? { free: true, text: 'vstup zdarma' }
          : undefined,
        categories: options.categories,
        recurring: Boolean(first(values, 'RRULE')),
        cancelled: first(values, 'STATUS')?.value === 'CANCELLED',
        raw: { parser: 'ical' },
      });
      if (candidate && (!options.filter || options.filter(candidate)))
        parsed.set(candidate.externalId!, candidate);
    }
  }
  return upcoming([...parsed.values()], now);
};

export class IcalEventSource implements EventSource {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly url: string,
    public readonly intervalMinutes: number,
    public readonly enabled: boolean,
    private readonly feedUrl: string,
    private readonly options: IcalSourceOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetchUpcomingEvents(
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<RawEvent[]> {
    const response = await fetchSource(
      this.feedUrl,
      this.fetcher,
      options.signal,
    );
    return parseIcalEvents(
      await response.text(),
      this.url,
      options.now ?? new Date(),
      this.options,
    );
  }
}

export const impactHubCalendarFeed = (pageUrl: string): string =>
  new URL('/kalendar/?ical=1', pageUrl).toString();

export const nextcloudPublicCalendarFeed = (embedUrl: string): string => {
  const url = new URL(embedUrl);
  const token = url.pathname.match(/\/apps\/calendar\/embed\/([^/]+)/u)?.[1];
  if (!token) throw new Error('Invalid public Nextcloud calendar URL');
  return new URL(
    `/remote.php/dav/public-calendars/${encodeURIComponent(token)}?export`,
    url,
  ).toString();
};
