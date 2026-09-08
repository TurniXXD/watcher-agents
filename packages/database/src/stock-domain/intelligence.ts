import { createHash } from 'node:crypto';
import { finiteNumber, type NormalizedObservation } from '@watcher/core';
import { z } from 'zod';

export const canonicalEventTypeSchema = z.enum([
  'EARNINGS',
  'GUIDANCE',
  'INSIDER_TRANSACTION',
  'CLINICAL_TRIAL',
  'FDA_DECISION',
  'PRODUCT_LAUNCH',
  'GOVERNMENT_CONTRACT',
  'CONTRACT',
  'PATENT',
  'ACQUISITION',
  'MERGER',
  'DIVESTITURE',
  'FINANCING',
  'CAPITAL_RETURN',
  'PARTNERSHIP',
  'INDUSTRY',
  'PRICE_MOVE',
  'CAPITAL_RAISE',
  'BUYBACK',
  'DIVIDEND',
  'MANAGEMENT_CHANGE',
  'ANALYST_REVISION',
  'LEGAL',
  'REGULATORY',
  'CONGRESSIONAL_TRANSACTION',
  'INSTITUTIONAL_POSITIONING',
  'OFF_EXCHANGE_ANOMALY',
  'COMPETITOR_EVENT',
  'MACRO_EVENT',
  'PRICE_ANOMALY',
  'VOLUME_ANOMALY',
  'OPTIONS_ANOMALY',
  'SHORT_INTEREST_CHANGE',
  'OTHER',
]);
export type CanonicalEventType = z.infer<typeof canonicalEventTypeSchema>;

export const eventDirectionSchema = z.enum([
  'POSITIVE',
  'NEGATIVE',
  'MIXED',
  'NEUTRAL',
  'UNKNOWN',
]);
export type EventDirection = z.infer<typeof eventDirectionSchema>;

export const eventSurpriseSchema = z.enum([
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'UNKNOWN',
]);
export type EventSurprise = z.infer<typeof eventSurpriseSchema>;

export const materialitySchema = z.enum([
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'EXTREME',
]);
export type Materiality = z.infer<typeof materialitySchema>;

export const eventActionSchema = z.enum([
  'STORE',
  'STATE_UPDATE',
  'TARGETED_ANALYSIS',
  'FULL_ANALYSIS',
  'IMMEDIATE_ANALYSIS',
]);
export type EventAction = z.infer<typeof eventActionSchema>;

export const evidenceRoleSchema = z.enum([
  'PRIMARY',
  'CONFIRMATION',
  'REACTION',
  'INTERPRETATION',
]);
export type EvidenceRole = z.infer<typeof evidenceRoleSchema>;

export const eventDecisionSchema = z.enum([
  'ANALYZE',
  'STORED',
  'DUPLICATE',
  'COOLDOWN',
]);
export type EventDecision = z.infer<typeof eventDecisionSchema>;

export type CanonicalEventCandidate = {
  ticker: string;
  eventType: CanonicalEventType;
  eventTypes: CanonicalEventType[];
  title: string;
  occurredAt: Date | null;
  firstPublicAt: Date | null;
  firstDetectedAt: Date;
  direction: EventDirection;
  magnitude: Record<string, unknown>;
  surprise: EventSurprise;
  materiality: Materiality;
  materialityScore: number;
  materialityReasons: string[];
  action: EventAction;
  fingerprint: string;
  evidencePriority: number;
};

export type MaterialityContext = {
  marketCapUsd?: number | null;
  annualRevenueUsd?: number | null;
};

const typePatterns: ReadonlyArray<[CanonicalEventType, RegExp]> = [
  [
    'FDA_DECISION',
    /\b(fda|food and drug administration)\b.*\b(approv|reject|decision|clearance|complete response)\b/i,
  ],
  ['ACQUISITION', /\b(acqui(?:re|res|red|sition)|merger|takeover)\b/i],
  ['DIVESTITURE', /\b(divest|spin[- ]?off|asset sale)\b/i],
  ['GUIDANCE', /\b(guidance|outlook|forecast)\b/i],
  [
    'EARNINGS',
    /\b(earnings|quarterly results|annual results|form 10-[qk]|10-[qk]|q[1-4]\s+(?:results|revenue|sales|eps))\b/i,
  ],
  [
    'ANALYST_REVISION',
    /\b(price target|target price|analyst (?:upgrade|downgrade|action)|upgrade[sd]?|downgrade[sd]?|raises? (?:its )?target|cuts? (?:its )?target|initiates? coverage)\b/i,
  ],
  [
    'CAPITAL_RAISE',
    /\b(secondary offering|public offering|private placement|capital raise|convertible notes?)\b/i,
  ],
  ['BUYBACK', /\b(share repurchase|stock repurchase|buyback)\b/i],
  ['DIVIDEND', /\b(dividend)\b/i],
  [
    'MANAGEMENT_CHANGE',
    /\b(appoint(?:ed|ment)?|resign(?:ed|ation)?|chief executive|chief financial|president|director|management change)\b/i,
  ],
  [
    'GOVERNMENT_CONTRACT',
    /\b(government|department of defense|dod|federal)\b.*\b(contract|award)\b/i,
  ],
  ['CONTRACT', /\b(contract|agreement|partnership|customer win)\b/i],
  ['PRODUCT_LAUNCH', /\b(product launch|launches|launched|new product)\b/i],
  ['PATENT', /\bpatent\b/i],
  ['LEGAL', /\b(lawsuit|litigation|settlement|subpoena|investigation)\b/i],
  ['REGULATORY', /\b(regulatory|sec filing|8-k|form 8-k)\b/i],
];

const highImpactPattern =
  /\b(bankrupt(?:cy)?|chapter 11|trading halt|fraud|restatement|going concern|fda rejection|complete response letter)\b/i;
const strategicPattern =
  /\b(acquisition|merger|takeover|guidance|buyback|public offering|private placement|major contract|fda approval)\b/i;

const evidencePriority = (observation: NormalizedObservation): number => {
  if (observation.sourceType === 'REGULATORY') return 100;
  if (observation.sourceType === 'INVESTOR_RELATIONS') return 90;
  if (observation.sourceType === 'NEWS') return 70;
  if (observation.sourceType === 'ANALYST') return 55;
  if (observation.sourceType === 'MARKET_DATA') return 45;
  return Math.round(observation.reliability * 50);
};

const classifyEventTypes = (
  observation: NormalizedObservation,
  text: string,
): CanonicalEventType[] => {
  const values: CanonicalEventType[] = [];
  const add = (value: CanonicalEventType): void => {
    if (!values.includes(value)) values.push(value);
  };
  const categories: Record<string, CanonicalEventType> = {
    INSIDER_TRANSACTION: 'INSIDER_TRANSACTION',
    ANALYST_SNAPSHOT: 'ANALYST_REVISION',
    EARNINGS: 'EARNINGS',
    GOVERNMENT_CONTRACT: 'GOVERNMENT_CONTRACT',
    PATENT: 'PATENT',
    CONGRESSIONAL_TRANSACTION: 'CONGRESSIONAL_TRANSACTION',
    CLINICAL_TRIAL: 'CLINICAL_TRIAL',
    FDA_DECISION: 'FDA_DECISION',
    INSTITUTIONAL_POSITIONING: 'INSTITUTIONAL_POSITIONING',
    OPTIONS_SNAPSHOT: 'OPTIONS_ANOMALY',
    SHORT_INTEREST_SNAPSHOT: 'SHORT_INTEREST_CHANGE',
  };
  const category = categories[observation.category];
  if (category) add(category);
  for (const [eventType, pattern] of typePatterns) {
    if (pattern.test(text)) add(eventType);
  }
  if (/\bmerger\b/i.test(text)) add('MERGER');
  if (
    /\b(secondary offering|public offering|private placement|capital raise|convertible notes?)\b/i.test(
      text,
    )
  )
    add('FINANCING');
  if (/\b(share repurchase|stock repurchase|buyback|dividend)\b/i.test(text))
    add('CAPITAL_RETURN');
  if (/\b(partnership|strategic alliance|collaboration)\b/i.test(text))
    add('PARTNERSHIP');
  if (/\b(industry|sector|dram|nand|memory pricing)\b/i.test(text))
    add('INDUSTRY');
  if (
    /\b(?:jumps?|surges?|soars?|falls?|drops?|plunges?)\s+\d+(?:\.\d+)?%/i.test(
      text,
    )
  )
    add('PRICE_MOVE');
  if (
    /\b(?:stock|shares?)\b.{0,30}\b(?:jump|surge|soar|fall|drop|plunge)s?\b/i.test(
      text,
    )
  )
    add('PRICE_MOVE');
  if (values.length === 0)
    add(observation.sourceType === 'REGULATORY' ? 'REGULATORY' : 'OTHER');
  return values;
};

const materialityFor = (
  observation: NormalizedObservation,
  eventType: CanonicalEventType,
  text: string,
  context: MaterialityContext,
): Pick<
  CanonicalEventCandidate,
  'materiality' | 'materialityScore' | 'materialityReasons' | 'action'
> & { magnitude: Record<string, unknown> } => {
  const numericFact = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = finiteNumber(observation.normalizedFacts[key]);
      if (value !== null) return value;
    }
    return null;
  };
  const financialImpactUsd = numericFact(
    'contractValueUsd',
    'financialImpactUsd',
    'transactionValueUsd',
    'aggregateMarketValue',
  );
  const scale = context.marketCapUsd ?? context.annualRevenueUsd ?? null;
  const relativeImpact =
    financialImpactUsd !== null && scale && scale > 0
      ? financialImpactUsd / scale
      : null;
  const fundamentalFactKeys = [
    'revenueYoYPercent',
    'revenueSurprise',
    'revenueSurprisePercent',
    'latestRevenue',
    'latestRevenueEstimate',
    'epsSurprise',
    'epsSurprisePercent',
    'latestEps',
    'latestEstimate',
    'grossMarginPercent',
    'priorGrossMarginPercent',
    'grossMarginChangeBps',
    'ebitda',
    'priorEbitda',
    'ebitdaYoYPercent',
    'operatingMarginPercent',
    'operatingMarginChangeBps',
    'freeCashFlow',
    'guidancePrevious',
    'guidanceNew',
    'guidanceChangePercent',
    'analystTargetPrevious',
    'analystTargetNew',
    'analystRatingPrevious',
    'analystRatingNew',
    'debt',
    'cash',
  ] as const;
  const fundamentalDeltas = Object.fromEntries(
    fundamentalFactKeys.flatMap((key) => {
      const value = observation.normalizedFacts[key];
      return typeof value === 'number' || typeof value === 'string'
        ? [[key, value] as const]
        : [];
    }),
  );
  const magnitude = {
    ...(financialImpactUsd === null ? {} : { financialImpactUsd }),
    ...(relativeImpact === null ? {} : { relativeImpact }),
    ...(Object.keys(fundamentalDeltas).length === 0
      ? {}
      : { fundamentalDeltas }),
  };
  const rawForm = observation.normalizedFacts.form;
  const form =
    typeof rawForm === 'string' || typeof rawForm === 'number'
      ? String(rawForm).toUpperCase()
      : '';
  if (eventType === 'INSIDER_TRANSACTION' || form === '4' || form === '144') {
    return {
      materiality: 'LOW',
      materialityScore: 24,
      materialityReasons: [
        'Routine insider or proposed-sale disclosure; no violation is inferred.',
      ],
      action: 'STATE_UPDATE',
      magnitude,
    };
  }
  if (eventType === 'PATENT' || eventType === 'CONGRESSIONAL_TRANSACTION') {
    return {
      materiality: 'LOW',
      materialityScore: 22,
      materialityReasons: [
        'Alternative-data observation retained as context, not as an independent investment signal.',
      ],
      action: 'STATE_UPDATE',
      magnitude,
    };
  }
  if (highImpactPattern.test(text)) {
    return {
      materiality: 'EXTREME',
      materialityScore: 95,
      materialityReasons: [
        'Potentially company-defining or urgent event language.',
      ],
      action: 'IMMEDIATE_ANALYSIS',
      magnitude,
    };
  }
  if (relativeImpact !== null && relativeImpact >= 0.1) {
    return {
      materiality: 'EXTREME',
      materialityScore: 92,
      materialityReasons: [
        'Reported financial impact is at least 10% of the available company-scale reference.',
      ],
      action: 'IMMEDIATE_ANALYSIS',
      magnitude,
    };
  }
  if (relativeImpact !== null && relativeImpact >= 0.03) {
    return {
      materiality: 'HIGH',
      materialityScore: 78,
      materialityReasons: [
        'Reported financial impact is at least 3% of the available company-scale reference.',
      ],
      action: 'FULL_ANALYSIS',
      magnitude,
    };
  }
  if (
    relativeImpact !== null &&
    relativeImpact < 0.001 &&
    (eventType === 'CONTRACT' || eventType === 'GOVERNMENT_CONTRACT')
  ) {
    return {
      materiality: 'LOW',
      materialityScore: 28,
      materialityReasons: [
        'Reported contract value is below 0.1% of the available company-scale reference.',
      ],
      action: 'STATE_UPDATE',
      magnitude,
    };
  }
  if (
    eventType === 'ACQUISITION' ||
    eventType === 'FDA_DECISION' ||
    strategicPattern.test(text)
  ) {
    return {
      materiality: 'HIGH',
      materialityScore: 78,
      materialityReasons: [
        'Strategic, financial, or regulatory catalyst detected.',
      ],
      action: 'FULL_ANALYSIS',
      magnitude,
    };
  }
  if (
    [
      'EARNINGS',
      'GUIDANCE',
      'CAPITAL_RAISE',
      'BUYBACK',
      'DIVIDEND',
      'MANAGEMENT_CHANGE',
      'GOVERNMENT_CONTRACT',
      'LEGAL',
      'REGULATORY',
    ].includes(eventType)
  ) {
    return {
      materiality: 'MEDIUM',
      materialityScore: observation.primarySource ? 60 : 52,
      materialityReasons: [
        observation.primarySource
          ? 'Potentially material event reported by a primary source.'
          : 'Potentially material company event requiring targeted analysis.',
      ],
      action: 'TARGETED_ANALYSIS',
      magnitude,
    };
  }
  if (
    eventType === 'ANALYST_REVISION' ||
    (eventType === 'INDUSTRY' &&
      /\b(tightness|shortage|supply|pricing|prices|record quarter|demand|gains)\b/i.test(
        text,
      )) ||
    eventType === 'PARTNERSHIP'
  ) {
    return {
      materiality: 'MEDIUM',
      materialityScore: 55,
      materialityReasons: [
        'A concrete analyst, industry supply/demand, or partnership development warrants impact analysis.',
      ],
      action: 'TARGETED_ANALYSIS',
      magnitude,
    };
  }
  return {
    materiality: 'LOW',
    materialityScore: 20,
    materialityReasons: [
      'No independently measurable material impact detected.',
    ],
    action: 'STATE_UPDATE',
    magnitude,
  };
};

const secAccession = (url: string): string | null => {
  const match = url.match(/\/Archives\/edgar\/data\/\d+\/(\d{18})\//i);
  return match?.[1] ?? null;
};

export const normalizedTitleTokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length >= 3),
  );

export const titleSimilarity = (left: string, right: string): number => {
  const a = normalizedTitleTokens(left);
  const b = normalizedTitleTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
};

export const extractCanonicalEvent = (
  observation: NormalizedObservation,
  context: MaterialityContext = {},
): CanonicalEventCandidate | null => {
  if (!observation.ticker) return null;
  if (
    observation.category === 'PRICE_SNAPSHOT' ||
    observation.category === 'OFF_EXCHANGE_SNAPSHOT'
  )
    return null;
  const text = `${observation.headline}\n${observation.rawText}`;
  const eventTypes = classifyEventTypes(observation, text);
  const eventType = eventTypes[0]!;
  const materiality = materialityFor(observation, eventType, text, context);
  const occurredAt = observation.eventAt ?? observation.publishedAt;
  const accession = secAccession(observation.sourceUrl);
  const dateBucket = occurredAt?.toISOString().slice(0, 10) ?? 'unknown-date';
  const titleKey = [...normalizedTitleTokens(observation.headline)]
    .sort()
    .join('-');
  const identity = accession
    ? `${observation.ticker}:${eventType}:sec:${accession}`
    : `${observation.ticker}:${eventType}:${dateBucket}:${titleKey}`;

  return {
    ticker: observation.ticker,
    eventType,
    eventTypes,
    title: observation.headline,
    occurredAt,
    firstPublicAt: observation.publishedAt,
    firstDetectedAt: observation.discoveredAt,
    direction: 'UNKNOWN',
    surprise: 'UNKNOWN',
    ...materiality,
    fingerprint: createHash('sha256').update(identity).digest('hex'),
    evidencePriority: evidencePriority(observation),
  };
};

export const materialityRank = (materiality: Materiality): number =>
  ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'].indexOf(materiality);
