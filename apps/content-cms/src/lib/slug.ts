import { createHash } from 'node:crypto';
import { DEFAULT_TIME_ZONE, localDateString } from './time';

const MAX_SLUG_LENGTH = 80;

export const slugify = (value: string): string => {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[łŁ]/gu, 'l')
    .replace(/[đĐ]/gu, 'd')
    .replace(/ß/gu, 'ss')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const truncated = slug.slice(0, MAX_SLUG_LENGTH);
  const boundary = truncated.lastIndexOf('-');
  return (boundary > 20 ? truncated.slice(0, boundary) : truncated).replace(
    /-+$/u,
    '',
  );
};

export const isValidSlug = (value: string): boolean =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 120;

/** Short, stable discriminator derived from a source identity. */
export const identitySuffix = (identity: string): string =>
  createHash('sha256').update(identity).digest('hex').slice(0, 6);

/**
 * Stable event slug: title plus the local start date. The date keeps recurring
 * events with the same title distinct and makes URLs human readable.
 */
export const eventSlug = (
  title: string,
  startsAt: Date,
  timeZone = DEFAULT_TIME_ZONE,
): string => {
  const base = slugify(title) || 'event';
  return `${base}-${localDateString(startsAt, timeZone)}`;
};

export const contentSlug = (title: string, fallback: string): string =>
  slugify(title) || fallback;

/** Appends the identity suffix used when a natural slug is already taken. */
export const disambiguateSlug = (slug: string, identity: string): string =>
  `${slug}-${identitySuffix(identity)}`;
