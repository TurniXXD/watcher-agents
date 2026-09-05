import type { StockThesisState } from '@watcher/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { WatcherStore } from '../store.js';
import { ValidationStore } from '../validation-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const thesisState = (
  ticker: string,
  verdict: 'BUY' | 'WATCH',
): StockThesisState => ({
  ticker,
  thesis: verdict === 'BUY' ? 'Improving evidence.' : 'Still monitoring.',
  verdict,
  confidence: 0.7,
  attentionScore: 72,
  bullScore: 3,
  bearScore: 1,
  netSignal: 2,
  signalGroups: [
    {
      group: 'FUNDAMENTALS',
      score: 2,
      availability: 'AVAILABLE',
      explanation: 'Stored test evidence.',
    },
  ],
  catalysts: ['Earnings'],
  insiderConviction: null,
  pricedIn: 'PARTIALLY_PRICED_IN',
  primaryDrivers: ['Earnings'],
  risks: ['Execution'],
  dataCoverage: 75,
  dataQuality: 'HIGH',
  materialDataGaps: [],
  decision: {
    recommendation: verdict,
    expectedValuePercent: 8,
    asymmetry: 'GOOD',
    probabilityHigher: {
      sevenDays: { minimum: 50, maximum: 60 },
      thirtyDays: { minimum: 60, maximum: 70 },
      ninetyDays: { minimum: 60, maximum: 75 },
      twelveMonths: { minimum: 65, maximum: 80 },
    },
    scenarios: {
      bull: {
        probabilityPercent: { minimum: 25, maximum: 35 },
        expectedReturnPercent: { minimum: 20, maximum: 30 },
        assumptions: [],
        requiredCatalysts: [],
        invalidationConditions: [],
      },
      base: {
        probabilityPercent: { minimum: 40, maximum: 50 },
        expectedReturnPercent: { minimum: 5, maximum: 10 },
        assumptions: [],
        requiredCatalysts: [],
        invalidationConditions: [],
      },
      bear: {
        probabilityPercent: { minimum: 20, maximum: 30 },
        expectedReturnPercent: { minimum: -20, maximum: -10 },
        assumptions: [],
        requiredCatalysts: [],
        invalidationConditions: [],
      },
    },
    pricedIn: {
      classification: 'PARTIALLY_PRICED_IN',
      explanation: 'Some evidence is reflected.',
    },
    maxRecommendedPositionPercent: { minimum: 0, maximum: 3 },
    rationale: ['Positive expected value.'],
    humanReviewRequired: true,
  },
});

integration('ValidationStore with PostgreSQL', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);
  const watcher = new WatcherStore(database);
  const validation = new ValidationStore(database);

  beforeEach(async () => {
    await database.backtestOutcome.deleteMany();
    await database.validationRun.deleteMany();
    await database.stockAlert.deleteMany();
    await database.thesisRevision.deleteMany();
    await database.companyThesisState.deleteMany();
    await database.eventObservation.deleteMany();
    await database.canonicalEvent.deleteMany();
    await database.eventChain.deleteMany();
    await database.analysis.deleteMany();
    await database.watcherRun.deleteMany();
    await database.processedItem.deleteMany();
    await database.telegramChat.deleteMany();
  });

  afterAll(async () => database.$disconnect());

  it('excludes future detections and revisions from strict as-of replay', async () => {
    const fixture = await seedValidationFixture(database, watcher);
    const replay = await validation.analyzeAsOf(
      fixture.chatId,
      'VAL',
      new Date('2026-01-05T23:59:59Z'),
    );

    expect(replay?.events.map((event) => event.title)).toEqual([
      'Known earnings event',
    ]);
    expect(replay?.thesis?.verdict).toBe('BUY');
    expect(replay?.price?.close).toBe(102);
  });

  it('persists idempotent backtests and calibrates completed outcomes', async () => {
    const fixture = await seedValidationFixture(database, watcher);
    const result = await validation.runValidation(fixture.configId);
    const repeated = await validation.runValidation(fixture.configId);
    const outcomes = await database.backtestOutcome.findMany({
      where: { watcherConfigId: fixture.configId },
    });
    const summary = await validation.getBacktestSummary(fixture.configId);
    const calibration = await validation.getCalibration(fixture.configId);

    expect(result).toMatchObject({ status: 'SUCCESS', targetCount: 4 });
    expect(repeated).toMatchObject({ status: 'SUCCESS', targetCount: 4 });
    expect(outcomes).toHaveLength(4);
    expect(summary.horizons.thirtyDays).toMatchObject({
      sampleSize: 3,
      hitRatePercent: 100,
    });
    expect(
      calibration.find((bucket) => bucket.label === '65–70%'),
    ).toMatchObject({ sampleSize: 1, realizedHigherPercent: 100 });
  });
});

const seedValidationFixture = async (
  database: ReturnType<typeof createDatabaseClient>,
  watcher: WatcherStore,
) => {
  const chat = await watcher.ensureChat('STOCKS', 9_009n);
  await database.stock.create({
    data: {
      chatConfigId: chat.id,
      symbol: 'VAL',
      companyName: 'Validation Corp',
      sector: 'Technology',
    },
  });
  const run = await database.watcherRun.create({
    data: { watcherConfigId: chat.watcherConfig!.id, trigger: 'MANUAL' },
  });
  const evidence = await database.processedItem.create({
    data: {
      watcherKind: 'STOCKS',
      source: 'SEC',
      externalId: 'validation-known',
      title: 'Known earnings event',
      url: 'https://www.sec.gov/validation-known',
      publishedAt: new Date('2026-01-01T12:00:00Z'),
      ticker: 'VAL',
      contentHash: 'validation-known',
      metadata: {},
    },
  });
  const chain = await database.eventChain.create({ data: { ticker: 'VAL' } });
  const event = await database.canonicalEvent.create({
    data: {
      ticker: 'VAL',
      eventType: 'EARNINGS',
      title: evidence.title,
      fingerprint: 'validation-known-event',
      firstDetectedAt: new Date('2026-01-02T08:00:00Z'),
      direction: 'POSITIVE',
      surprise: 'HIGH',
      materiality: 'HIGH',
      materialityScore: 80,
      action: 'FULL_ANALYSIS',
      evidencePriority: 100,
      primaryEvidenceId: evidence.id,
      chainId: chain.id,
    },
  });
  await database.eventObservation.create({
    data: {
      eventId: event.id,
      processedItemId: evidence.id,
      runId: run.id,
      role: 'PRIMARY',
      decision: 'ANALYZE',
      createdEvent: true,
    },
  });
  const analysis = await database.analysis.create({
    data: {
      runId: run.id,
      processedItemId: evidence.id,
      status: 'SUCCESS',
      result: {},
    },
  });
  await database.thesisRevision.create({
    data: {
      ticker: 'VAL',
      eventId: event.id,
      processedItemId: evidence.id,
      analysisId: analysis.id,
      thesisChange: 'IMPROVED',
      informationChange: 'NEW_INFORMATION',
      fullAnalysisPerformed: true,
      redundancyClass: 'INDEPENDENT',
      redundancyMultiplier: 1,
      reliabilityWeight: 1,
      targetedAnalysis: {},
      resultingState: thesisState('VAL', 'BUY'),
      createdAt: new Date('2026-01-03T08:00:00Z'),
    },
  });
  await database.stockAlert.create({
    data: {
      watcherConfigId: chat.watcherConfig!.id,
      runId: run.id,
      eventId: event.id,
      ticker: 'VAL',
      type: 'HIGH_PRIORITY',
      severity: 'HIGH',
      title: 'Validation alert',
      reasons: [],
      snapshot: {},
      eventDetectedAt: event.firstDetectedAt,
      analysisCompletedAt: new Date('2026-01-03T08:00:00Z'),
    },
  });
  const futureEvidence = await database.processedItem.create({
    data: {
      watcherKind: 'STOCKS',
      source: 'SEC',
      externalId: 'validation-late-detection',
      title: 'Old filing discovered later',
      url: 'https://www.sec.gov/validation-late',
      publishedAt: new Date('2026-01-01T12:00:00Z'),
      ticker: 'VAL',
      contentHash: 'validation-late',
      metadata: {},
    },
  });
  const futureEvent = await database.canonicalEvent.create({
    data: {
      ticker: 'VAL',
      eventType: 'OTHER',
      title: futureEvidence.title,
      fingerprint: 'validation-late-event',
      firstDetectedAt: new Date('2026-01-10T08:00:00Z'),
      direction: 'UNKNOWN',
      surprise: 'UNKNOWN',
      materiality: 'LOW',
      materialityScore: 20,
      action: 'STORE',
      evidencePriority: 50,
      primaryEvidenceId: futureEvidence.id,
      chainId: chain.id,
    },
  });
  await database.eventObservation.create({
    data: {
      eventId: futureEvent.id,
      processedItemId: futureEvidence.id,
      runId: run.id,
      role: 'PRIMARY',
      decision: 'ANALYZE',
      createdEvent: true,
    },
  });
  for (const [externalId, observedAt, close] of [
    ['price-anchor', new Date('2026-01-01T16:00:00Z'), 100],
    ['price-day', new Date('2026-01-03T16:00:00Z'), 102],
    ['price-month', new Date('2026-02-03T16:00:00Z'), 110],
  ] as const) {
    const item = await database.processedItem.create({
      data: {
        watcherKind: 'STOCKS',
        source: 'PRICE',
        externalId,
        title: externalId,
        url: `https://example.com/${externalId}`,
        publishedAt: observedAt,
        ticker: 'VAL',
        contentHash: externalId,
        metadata: {},
      },
    });
    await database.marketSnapshot.create({
      data: {
        processedItemId: item.id,
        ticker: 'VAL',
        observedAt,
        open: close,
        high: close + 2,
        low: close - 2,
        close,
        volume: 100_000n,
      },
    });
  }
  return { chatId: chat.id, configId: chat.watcherConfig!.id };
};
