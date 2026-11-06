import type { Where } from 'payload';
import { decodeCursor, encodeCursor, type Cursor } from '../lib/cursor';
import { slugify } from '../lib/slug';
import { DEFAULT_TIME_ZONE, resolveDateFilter } from '../lib/time';
import type { ContentListQuery, EventsQuery } from './schemas';

export class QueryInputError extends Error {}

const LISTED: Where = {
  and: [
    { _status: { equals: 'published' } },
    { reviewStatus: { equals: 'approved' } },
  ],
};

/** Events with an unresolved conflicting date change leave public listings after the grace period. */
export const criticalGraceWhere = (now: Date, graceHours: number): Where => ({
  or: [
    { criticalUpdatePendingSince: { exists: false } },
    {
      criticalUpdatePendingSince: {
        greater_than: new Date(
          now.getTime() - graceHours * 3_600_000,
        ).toISOString(),
      },
    },
  ],
});

export const sortField = (sort: string) => ({
  field: sort.replace(/^-/u, ''),
  descending: sort.startsWith('-'),
});

/** Keyset condition: rows strictly after the cursor in (field, id) order. */
export const cursorWhere = (sort: string, cursor: Cursor): Where => {
  const { field, descending } = sortField(sort);
  const beyond = descending ? 'less_than' : 'greater_than';
  // Listings only page over rows whose sort field is non-null.
  if (cursor.v === null) return { id: { [beyond]: cursor.id } };
  return {
    or: [
      { [field]: { [beyond]: cursor.v } },
      {
        and: [
          { [field]: { equals: cursor.v } },
          { id: { [beyond]: cursor.id } },
        ],
      },
    ],
  };
};

export const sortClause = (sort: string): string[] => {
  const { descending } = sortField(sort);
  return [sort, descending ? '-id' : 'id'];
};

export const nextCursorFor = (
  sort: string,
  last: Record<string, unknown> | undefined,
): string | null => {
  if (!last) return null;
  const { field } = sortField(sort);
  const value = last[field];
  return encodeCursor({
    s: sort,
    v:
      value === null || value === undefined
        ? null
        : value instanceof Date
          ? value.toISOString()
          : (value as string | number),
    id: String(last.id),
  });
};

const decodeOrThrow = (
  value: string | undefined,
  sort: string,
): Cursor | null => {
  if (!value) return null;
  const cursor = decodeCursor(value, sort);
  if (!cursor) throw new QueryInputError('Invalid cursor for this sort order');
  return cursor;
};

export const buildEventsWhere = (
  query: EventsQuery,
  now: Date,
  graceHours: number,
): Where => {
  const conditions: Where[] = [LISTED, criticalGraceWhere(now, graceHours)];
  if (query.city.toLowerCase() !== 'all')
    conditions.push({ citySlug: { equals: slugify(query.city) } });
  if (query.category)
    conditions.push({ category: { equals: slugify(query.category) } });
  let from: Date | undefined;
  try {
    from = query.from
      ? resolveDateFilter(query.from, 'from', DEFAULT_TIME_ZONE).instant
      : undefined;
    if (query.to) {
      const to = resolveDateFilter(query.to, 'to', DEFAULT_TIME_ZONE);
      conditions.push({
        startsAt: {
          [to.exclusive ? 'less_than' : 'less_than_equal']:
            to.instant.toISOString(),
        },
      });
      if (from && to.instant <= from)
        throw new QueryInputError('`to` must be after `from`');
    }
  } catch (error) {
    if (error instanceof QueryInputError) throw error;
    throw new QueryInputError(
      error instanceof Error ? error.message : 'Invalid date filter',
    );
  }
  if (from || !query.to) {
    const start = (from ?? now).toISOString();
    conditions.push({
      or: [
        { startsAt: { greater_than_equal: start } },
        { endsAt: { greater_than_equal: start } },
      ],
    });
  }
  if (query.q) {
    conditions.push({
      or: ['title', 'summary', 'venueName', 'organizerName'].map((field) => ({
        [field]: { like: query.q },
      })),
    });
  }
  if (query.free !== undefined)
    conditions.push({ isFree: { equals: query.free } });
  if (query.freeFood === true) conditions.push({ freeFood: { equals: 'yes' } });
  if (query.freeFood === false)
    conditions.push({ freeFood: { not_equals: 'yes' } });
  if (query.featured !== undefined)
    conditions.push({ featured: { equals: query.featured } });
  const cursor = decodeOrThrow(query.cursor, query.sort);
  if (cursor) conditions.push(cursorWhere(query.sort, cursor));
  return { and: conditions };
};

export const eventDetailWhere = (
  slug: string,
  now: Date,
  graceHours: number,
): Where => ({
  and: [
    { slug: { equals: slug } },
    { _status: { equals: 'published' } },
    { reviewStatus: { in: ['approved', 'archived'] } },
    criticalGraceWhere(now, graceHours),
  ],
});

export const CONTENT_SORT = '-publishedAt';

export const buildContentWhere = (
  query: ContentListQuery,
  now: Date,
  fields: { search: string[]; category?: string; tag?: string },
): Where => {
  const conditions: Where[] = [
    LISTED,
    { publishedAt: { exists: true } },
    {
      or: [
        { publishAt: { exists: false } },
        { publishAt: { less_than_equal: now.toISOString() } },
      ],
    },
  ];
  if (query.q)
    conditions.push({
      or: fields.search.map((field) => ({ [field]: { like: query.q } })),
    });
  if (query.category && fields.category)
    conditions.push({ [fields.category]: { equals: slugify(query.category) } });
  if (query.tag && fields.tag)
    conditions.push({ [fields.tag]: { equals: query.tag.toLowerCase() } });
  const cursor = decodeOrThrow(query.cursor, CONTENT_SORT);
  if (cursor) conditions.push(cursorWhere(CONTENT_SORT, cursor));
  return { and: conditions };
};

export const contentDetailWhere = (slug: string, now: Date): Where => ({
  and: [
    { slug: { equals: slug } },
    { _status: { equals: 'published' } },
    { reviewStatus: { in: ['approved', 'archived'] } },
    {
      or: [
        { publishAt: { exists: false } },
        { publishAt: { less_than_equal: now.toISOString() } },
      ],
    },
  ],
});
