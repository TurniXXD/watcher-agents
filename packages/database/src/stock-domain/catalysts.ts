import { createHash } from 'node:crypto';
import { parseDate, type NormalizedObservation } from '@watcher/core';
import type {
  CanonicalEventCandidate,
  CanonicalEventType,
  EventDirection,
} from './intelligence.js';
import { stringFact } from './facts.js';

export type CatalystType =
  | 'EARNINGS'
  | 'CLINICAL_RESULTS'
  | 'FDA_DECISION'
  | 'PRODUCT_LAUNCH'
  | 'COURT_DECISION'
  | 'INVESTOR_DAY'
  | 'CONTRACT'
  | 'GUIDANCE'
  | 'PATENT_EXPIRATION'
  | 'REGULATORY_DECISION';

export type CatalystCandidate = {
  ticker: string;
  catalystType: CatalystType;
  description: string;
  expectedStart: Date | null;
  expectedEnd: Date | null;
  exactDateKnown: boolean;
  proximity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMINENT';
  impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  direction: 'POSITIVE' | 'NEGATIVE' | 'BINARY' | 'UNKNOWN';
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  fingerprint: string;
};

const catalystTypeFor = (
  eventType: CanonicalEventType,
): CatalystType | null => {
  const mapping: Partial<Record<CanonicalEventType, CatalystType>> = {
    EARNINGS: 'EARNINGS',
    GUIDANCE: 'GUIDANCE',
    CLINICAL_TRIAL: 'CLINICAL_RESULTS',
    FDA_DECISION: 'FDA_DECISION',
    PRODUCT_LAUNCH: 'PRODUCT_LAUNCH',
    GOVERNMENT_CONTRACT: 'CONTRACT',
    CONTRACT: 'CONTRACT',
    LEGAL: 'COURT_DECISION',
    REGULATORY: 'REGULATORY_DECISION',
  };
  return mapping[eventType] ?? null;
};

const catalystDirection = (
  eventType: CanonicalEventType,
  direction: EventDirection,
): CatalystCandidate['direction'] => {
  if (eventType === 'FDA_DECISION' || eventType === 'CLINICAL_TRIAL') {
    return 'BINARY';
  }
  return direction === 'POSITIVE' || direction === 'NEGATIVE'
    ? direction
    : 'UNKNOWN';
};

const proximityFor = (
  expected: Date | null,
  now: Date,
): CatalystCandidate['proximity'] => {
  if (!expected) return 'NONE';
  const days = (expected.getTime() - now.getTime()) / (24 * 60 * 60_000);
  if (days <= 1) return 'IMMINENT';
  if (days <= 7) return 'HIGH';
  if (days <= 30) return 'MEDIUM';
  return 'LOW';
};

export const catalystFromEvent = (
  event: CanonicalEventCandidate,
  observation: NormalizedObservation,
  now = new Date(),
): CatalystCandidate | null => {
  const catalystType = catalystTypeFor(event.eventType);
  if (!catalystType) return null;
  const expectedStart =
    parseDate(
      stringFact(
        observation.normalizedFacts,
        'nextEarningsDate',
        'expectedDate',
        'expectedStart',
        'fdaDate',
        'trialDate',
        'eventDate',
      ),
    ) ?? null;
  const expectedEnd =
    parseDate(
      stringFact(observation.normalizedFacts, 'expectedEnd', 'dateRangeEnd'),
    ) ?? null;
  const resolvedWithoutFutureDate =
    expectedStart === null &&
    event.occurredAt !== null &&
    event.occurredAt <= now &&
    (event.eventType === 'EARNINGS' || event.eventType === 'FDA_DECISION');
  const status = resolvedWithoutFutureDate
    ? ('COMPLETED' as const)
    : expectedStart && expectedStart > now
      ? ('UPCOMING' as const)
      : ('ACTIVE' as const);
  const fingerprint = createHash('sha256')
    .update(
      [
        event.ticker,
        catalystType,
        expectedStart?.toISOString() ?? 'unscheduled',
        event.title.toLowerCase(),
      ].join(':'),
    )
    .digest('hex');
  return {
    ticker: event.ticker,
    catalystType,
    description: event.title,
    expectedStart,
    expectedEnd,
    exactDateKnown: expectedStart !== null && expectedEnd === null,
    proximity: proximityFor(expectedStart, now),
    impact: event.materiality === 'NONE' ? 'LOW' : event.materiality,
    direction: catalystDirection(event.eventType, event.direction),
    status,
    fingerprint,
  };
};
