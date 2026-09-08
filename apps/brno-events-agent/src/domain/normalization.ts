import { createHash } from 'node:crypto';
import type { RawEvent } from './types.js';

export const normalizeText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

export const canonicalUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/iu.test(key)) url.searchParams.delete(key);
  return url.toString().replace(/\/$/u, '');
};

export const eventFingerprint = (event: RawEvent): string => {
  const roundedStart = Math.round(event.startAt.getTime() / 1_800_000);
  const identity = [
    normalizeText(event.title),
    roundedStart,
    normalizeText(event.venue?.name ?? event.venue?.address ?? ''),
  ].join('|');
  return createHash('sha256').update(identity).digest('hex');
};

export const eventContentHash = (event: RawEvent): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        title: normalizeText(event.title),
        description: normalizeText(event.description ?? ''),
        startAt: event.startAt.toISOString(),
        endAt: event.endAt?.toISOString(),
        venue: normalizeText(
          `${event.venue?.name ?? ''} ${event.venue?.address ?? ''}`,
        ),
        organizer: normalizeText(event.organizer?.name ?? ''),
        categories: [...event.categories].sort(),
        price: event.price,
        registrationRequired: event.registrationRequired,
        registrationUrl: event.registrationUrl,
        registrationDeadline: event.registrationDeadline?.toISOString(),
        cancelled: event.cancelled,
      }),
    )
    .digest('hex');
