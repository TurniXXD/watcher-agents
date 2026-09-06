import type { WatchItem } from '@watcher/core';
import type { DiscoveryCandidate } from '../stock-domain/discovery.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { PostgresEventJournal } from '../event-journal.js';
import { WatcherStore } from '../store.js';
import { CompanyUniverseStore } from '../universe-store.js';
import { StockDiscoveryStore } from '../discovery-store.js';
import { ResourceLeaseStore } from '../resource-lease-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const watchItem = (externalId: string): WatchItem => ({
  id: `SEC:${externalId}`,
  source: 'SEC',
  externalId,
  title: 'Filing',
  url: 'https://www.sec.gov/Archives/example',
  content: 'New filing content',
  sourceType: 'REGULATORY',
  primarySource: true,
  category: 'COMPANY_EVENT',
  normalizedFacts: { form: '8-K' },
  metadata: { symbol: 'MU' },
});

integration('WatcherStore with PostgreSQL', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const store = new WatcherStore(database);
  const universe = new CompanyUniverseStore(database);
  const eventJournal = new PostgresEventJournal(database);
  const discovery = new StockDiscoveryStore(database, {
    investigationMs: 90 * 60_000,
    highResolutionIntervalMs: 5 * 60_000,
    eventModeMs: 2 * 60 * 60_000,
    watchMs: 14 * 24 * 60 * 60_000,
  });

  beforeEach(async () => {
    await database.optionsSnapshot.deleteMany();
    await database.institutionalSnapshot.deleteMany();
    await database.shortInterestSnapshot.deleteMany();
    await database.stockAlert.deleteMany();
    await database.thesisRevision.deleteMany();
    await database.companyThesisState.deleteMany();
    await database.eventObservation.deleteMany();
    await database.canonicalEvent.deleteMany();
    await database.eventChain.deleteMany();
    await database.analysisCooldown.deleteMany();
    await database.sourceHealth.deleteMany();
    await database.telegramChat.deleteMany();
    await database.processedItem.deleteMany();
    await database.domainEvent.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('uses a database constraint to prepare an item only once per watcher', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    const firstRun = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!firstRun) throw new Error('Expected first run');
    const item = watchItem('0001');

    const prepared = await store.prepareItemsForRun(
      'STOCKS',
      firstRun.id,
      [item],
      5,
    );
    expect(prepared).toHaveLength(1);
    await store.saveAnalysis(firstRun.id, prepared[0]!.recordId, {
      status: 'SUCCESS',
      result: {
        title: 'Filing',
        summary: 'Summary',
        importance: 4,
        sentiment: 'neutral',
        eventType: '8-K',
        positives: [],
        negatives: [],
        risks: [],
        catalysts: [],
        confidence: 0.8,
      },
    });
    await store.finishRun(chat.watcherConfig!.id, firstRun.id, {
      status: 'SUCCESS',
    });

    const sameChatRun = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!sameChatRun) throw new Error('Expected same chat run');
    expect(
      await store.prepareItemsForRun('STOCKS', sameChatRun.id, [item], 5),
    ).toHaveLength(0);

    const secondChat = await store.ensureChat('STOCKS', 456n);
    const secondChatRun = await store.claimRun(
      secondChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!secondChatRun) throw new Error('Expected second chat run');
    const reused = await store.prepareItemsForRun(
      'STOCKS',
      secondChatRun.id,
      [item],
      5,
    );
    expect(reused).toHaveLength(1);
    expect(reused[0]?.outcome?.status).toBe('SUCCESS');
  });

  it('treats zero max analyses as unlimited', async () => {
    const chat = await store.ensureChat('PUBLICATIONS', 321n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');

    const prepared = await store.prepareItemsForRun(
      'PUBLICATIONS',
      run.id,
      [watchItem('pubmed-1'), watchItem('pubmed-2'), watchItem('pubmed-3')],
      0,
    );

    expect(prepared).toHaveLength(3);
  });

  it('atomically rejects a second overlapping run', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    const configId = chat.watcherConfig!.id;

    expect(await store.claimRun(configId, 'MANUAL')).toBeDefined();
    expect(await store.claimRun(configId, 'SCHEDULED')).toBeUndefined();
  });

  it('adds missing source switches to existing stocks', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    await database.stock.create({
      data: { chatConfigId: chat.id, symbol: 'MU' },
    });

    const [stock] = await store.listStocks(chat.id);

    expect(stock?.sources.map(({ source }) => source).sort()).toEqual(
      [
        'EARNINGS_WHISPERS',
        'FDA',
        'FINRA_SHORT_INTEREST',
        'FINVIZ',
        'INVESTOR_RELATIONS',
        'CLINICAL_TRIALS',
        'NEWS',
        'PRICE',
        'QUIVER_CONGRESS',
        'QUIVER_CONTRACTS',
        'QUIVER_INSIDERS',
        'QUIVER_OFF_EXCHANGE',
        'QUIVER_PATENTS',
        'QUIVER_LOBBYING',
        'ALPHA_VANTAGE_INSTITUTIONAL',
        'ALPHA_VANTAGE_OPTIONS',
        'SEC',
        'TRADINGVIEW_NEWS',
        'ZACKS',
      ].sort(),
    );
    expect(stock?.sources.every(({ enabled }) => enabled)).toBe(true);
  });

  it('persists normalized observations and an atomic discovery event', async () => {
    const chat = await store.ensureChat('STOCKS', 777n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const item = {
      ...watchItem('observation-1'),
      publishedAt: new Date('2026-09-04T06:00:00Z'),
      sourceType: 'REGULATORY' as const,
      primarySource: true,
      category: 'COMPANY_EVENT',
      normalizedFacts: { form: '8-K' },
      entities: ['MU'],
      reliability: 1,
      metadata: { symbol: 'MU' },
    };

    const prepared = await store.prepareItemsForRun(
      'STOCKS',
      run.id,
      [item],
      5,
    );
    const observation = await database.processedItem.findUniqueOrThrow({
      where: { id: prepared[0]!.recordId },
    });
    const [event] = await eventJournal.list('observation.discovered');

    expect(observation).toMatchObject({
      ticker: 'MU',
      sourceType: 'REGULATORY',
      sourceUrl: item.url,
      primarySource: true,
      category: 'COMPANY_EVENT',
      headline: item.title,
      rawText: item.content,
      reliability: 1,
    });
    expect(event).toMatchObject({
      type: 'observation.discovered',
      aggregateType: 'OBSERVATION',
      aggregateId: observation.id,
    });
  });

  it('removes null bytes before persisting provider content', async () => {
    const chat = await store.ensureChat('STOCKS', 778n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const unsafeItem: WatchItem = {
      ...watchItem('observation-with-nul'),
      title: 'Filing\u0000 update',
      content: 'Material\u0000 filing content',
      normalizedFacts: { form: '8-K\u0000', nested: ['safe\u0000 text'] },
      entities: ['M\u0000U'],
      metadata: { symbol: 'M\u0000U' },
    };

    await store.prepareItemsForRun('STOCKS', run.id, [unsafeItem], 5);
    const observation = await database.processedItem.findUniqueOrThrow({
      where: {
        watcherKind_source_externalId: {
          watcherKind: 'STOCKS',
          source: unsafeItem.source,
          externalId: unsafeItem.externalId,
        },
      },
    });

    expect(observation).toMatchObject({
      title: 'Filing update',
      headline: 'Filing update',
      rawText: 'Material filing content',
      ticker: 'MU',
      normalizedFacts: { form: '8-K', nested: ['safe text'] },
      entities: ['MU'],
      metadata: { symbol: 'MU' },
    });
  });

  it('stores routine insider filings without spending an analysis slot', async () => {
    const chat = await store.ensureChat('STOCKS', 780n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const item: WatchItem = {
      ...watchItem('0001104659-26-101067'),
      title: 'Micron Form 4 ownership filing',
      url: 'https://www.sec.gov/Archives/edgar/data/723125/000110465926101067/primary.xml',
      category: 'INSIDER_TRANSACTION',
      normalizedFacts: { form: '4' },
    };

    expect(
      await store.prepareItemsForRun('STOCKS', run.id, [item], 5),
    ).toHaveLength(0);
    const event = await database.canonicalEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      eventType: 'INSIDER_TRANSACTION',
      materiality: 'LOW',
      action: 'STATE_UPDATE',
      analysisClaimedAt: null,
    });
    expect(await store.getRunIntelligenceSummary(run.id)).toMatchObject({
      newEventCount: 1,
      storedOnlyCount: 1,
    });
  });

  it('persists a versioned thesis and deterministic decision result', async () => {
    const chat = await store.ensureChat('STOCKS', 799n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const [prepared] = await store.prepareItemsForRun(
      'STOCKS',
      run.id,
      [watchItem('phase-five-six')],
      5,
    );
    if (!prepared) throw new Error('Expected prepared stock event');
    const analysisContext = prepared.item.metadata.stockAnalysisContext as {
      event: { id: string };
    };
    const state = {
      ticker: 'MU',
      thesis: 'Primary evidence supports monitoring earnings momentum.',
      verdict: 'WATCH' as const,
      confidence: 0.7,
      attentionScore: 90,
      bullScore: 3,
      bearScore: 1,
      netSignal: 2,
      signalGroups: [],
      catalysts: [],
      insiderConviction: null,
      pricedIn: 'UNKNOWN' as const,
      primaryDrivers: ['Regulatory filing'],
      risks: ['Incomplete valuation data'],
      dataCoverage: 70,
      dataQuality: 'MEDIUM' as const,
      materialDataGaps: ['OPTIONS_POSITIONING'],
      decision: {
        recommendation: 'WATCH' as const,
        expectedValuePercent: 4,
        asymmetry: 'FAIR' as const,
        probabilityHigher: {
          sevenDays: null,
          thirtyDays: { minimum: 45, maximum: 60 },
          ninetyDays: null,
          twelveMonths: null,
        },
        scenarios: {
          bull: {
            probabilityPercent: { minimum: 20, maximum: 30 },
            expectedReturnPercent: { minimum: 15, maximum: 25 },
            assumptions: [],
            requiredCatalysts: [],
            invalidationConditions: [],
          },
          base: {
            probabilityPercent: { minimum: 45, maximum: 55 },
            expectedReturnPercent: { minimum: 0, maximum: 8 },
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
          classification: 'UNKNOWN' as const,
          explanation: 'Market-expectation evidence is incomplete.',
        },
        maxRecommendedPositionPercent: { minimum: 0, maximum: 0 },
        rationale: ['Human review is required.'],
        humanReviewRequired: true,
      },
    };
    await store.saveAnalysis(run.id, prepared.recordId, {
      status: 'SUCCESS',
      metrics: {
        durationMs: 1_200,
        llmCallCount: 2,
        promptTokens: 700,
        completionTokens: 300,
        estimatedCostUsd: 0,
      },
      result: {
        title: 'Filing',
        summary: 'Summary',
        importance: 7,
        sentiment: 'neutral',
        eventType: 'REGULATORY',
        positives: [],
        negatives: [],
        risks: state.risks,
        catalysts: [],
        confidence: state.confidence,
        intelligence: {
          eventId: analysisContext.event.id,
          targeted: {
            materiality: 'MEDIUM',
            thesisChange: 'IMPROVED',
            informationChange: 'NEW_INFORMATION',
            reanalysisRequired: false,
            affectedSignalGroups: [],
            catalystChange: 'UNCHANGED',
            recommendationChange: false,
            primaryDriver: 'Regulatory filing',
            explanation: 'The filing does not yet change the thesis.',
            risks: state.risks,
            confidence: 0.7,
          },
          fullAnalysisPerformed: true,
          redundancyClass: 'INDEPENDENT',
          redundancyMultiplier: 1,
          reliabilityWeight: 1.5,
          state,
          decision: state.decision,
        },
      },
    });

    expect(await store.getStockThesis('mu')).toMatchObject({
      ticker: 'MU',
      verdict: 'WATCH',
      version: 1,
      lastEventId: analysisContext.event.id,
    });
    expect(
      await database.thesisRevision.findUnique({
        where: { eventId: analysisContext.event.id },
      }),
    ).toMatchObject({
      thesisChange: 'IMPROVED',
      fullAnalysisPerformed: true,
      redundancyClass: 'INDEPENDENT',
    });
    expect(await database.analysis.findFirst()).toMatchObject({
      durationMs: 1_200,
      llmCallCount: 2,
      promptTokens: 700,
      completionTokens: 300,
    });
    const [alert] = await store.claimPendingAlerts(chat.watcherConfig!.id);
    expect(alert).toMatchObject({
      ticker: 'MU',
      type: 'THESIS_CHANGE',
      severity: 'MEDIUM',
      deliveryAttempts: 0,
    });
    if (!alert) throw new Error('Expected an alert');
    await store.markAlertDelivered(alert.id);
    expect(
      await database.stockAlert.findUnique({ where: { id: alert.id } }),
    ).toMatchObject({
      deliveryAttempts: 1,
      deliveryClaimedAt: null,
    });
  });

  it('claims and reschedules persisted daily reconciliation', async () => {
    const chat = await store.ensureChat('STOCKS', 801n);
    const configId = chat.watcherConfig!.id;
    const now = new Date('2026-09-05T05:00:00Z');
    await database.watcherConfig.update({
      where: { id: configId },
      data: { nextReconciliationAt: now },
    });

    expect(await store.listDueReconciliations('STOCKS', now)).toHaveLength(1);
    expect(await store.claimReconciliation(configId, now)).toBe(true);
    expect(await store.claimReconciliation(configId, now)).toBe(false);
    const finished = await store.finishReconciliation(
      configId,
      'SUCCESS',
      24 * 60 * 60_000,
      now,
    );

    expect(finished).toMatchObject({
      reconciliationInProgress: false,
      lastReconciliationAt: now,
      nextReconciliationAt: new Date('2026-09-06T05:00:00Z'),
    });
  });

  it('persists classified insider transactions and detects a purchase cluster', async () => {
    const chat = await store.ensureChat('STOCKS', 787n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const items = ['Jane Doe', 'John Doe', 'Alex Doe'].map(
      (owner, index): WatchItem => ({
        ...watchItem(`form4-buy-${index}`),
        title: `MU Form 4 purchase by ${owner}`,
        category: 'INSIDER_TRANSACTION',
        normalizedFacts: {
          form: '4',
          owner,
          role: index === 0 ? 'Chief Executive Officer' : 'Director',
          transactionCode: 'P',
          acquiredDisposedCode: 'A',
          transactionDate: `2026-09-0${index + 1}`,
          shares: 10_000,
          pricePerShare: 100,
          sharesOwnedFollowing: 20_000,
        },
      }),
    );

    await store.prepareItemsForRun('STOCKS', run.id, items, 5);

    const signals = await database.insiderSignal.findMany({
      orderBy: { occurredAt: 'asc' },
    });
    expect(signals).toHaveLength(3);
    expect(signals[0]).toMatchObject({
      transactionType: 'OPEN_MARKET_BUY',
      planned: false,
      discretionary: true,
      convictionScore: 5,
    });
    expect(signals[2]?.clusterSize).toBe(3);
    expect(
      await database.canonicalEvent.count({
        where: { materiality: 'HIGH' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('links market anomalies to known drivers and keeps unknown anomalies in investigation', async () => {
    const chat = await store.ensureChat('STOCKS', 788n);
    await database.stock.create({
      data: {
        chatConfigId: chat.id,
        symbol: 'AMD',
        monitoringTier: 'DISCOVERY',
        monitoringMode: 'LOW_RESOLUTION',
      },
    });
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const snapshots = Array.from({ length: 6 }, (_, index): WatchItem => {
      const observedAt = new Date(Date.UTC(2026, 7, 31 + index, 20));
      const date = observedAt.toISOString().slice(0, 10);
      const anomaly = index === 5;
      return {
        id: `PRICE:AMD:${date}`,
        source: 'PRICE',
        externalId: `AMD:${date}`,
        title: `AMD market price ${anomaly ? 110 : 100}`,
        url: 'https://stooq.com/q/?s=amd.us',
        publishedAt: observedAt,
        eventAt: observedAt,
        content: 'Daily price snapshot',
        sourceType: 'MARKET_DATA',
        primarySource: false,
        category: 'PRICE_SNAPSHOT',
        normalizedFacts: {
          open: anomaly ? 106 : 100,
          high: anomaly ? 111 : 101,
          low: anomaly ? 105 : 99,
          close: anomaly ? 110 : 100,
          volume: anomaly ? 5_000 : 1_000,
        },
        metadata: { symbol: 'AMD' },
      };
    });

    await store.prepareItemsForRun('STOCKS', run.id, snapshots, 5);
    const event = await database.canonicalEvent.findFirstOrThrow({
      where: { eventType: 'PRICE_ANOMALY' },
    });
    const snapshot = await database.marketSnapshot.findFirstOrThrow({
      where: { priceAnomaly: true },
    });
    expect(event).toMatchObject({
      direction: 'UNKNOWN',
      action: 'STATE_UPDATE',
      primaryDriverId: null,
    });
    expect(snapshot.unexplained).toBe(true);

    await store.prepareItemsForRun(
      'STOCKS',
      run.id,
      [
        {
          ...watchItem('amd-driver'),
          title: 'AMD announces major acquisition',
          content: 'AMD entered a definitive merger agreement.',
          publishedAt: new Date('2026-09-05T18:00:00Z'),
          eventAt: new Date('2026-09-05T18:00:00Z'),
          metadata: { symbol: 'AMD' },
        },
      ],
      5,
    );
    const linkedEvent = await database.canonicalEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    const linkedSnapshot = await database.marketSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    expect(linkedEvent.primaryDriverId).not.toBeNull();
    expect(linkedSnapshot).toMatchObject({
      unexplained: false,
      primaryDriverId: linkedEvent.primaryDriverId,
    });

    const intelligence = await store.getRunIntelligenceSummary(run.id);
    await discovery.escalateAttentionSignals(chat.id, intelligence);
    expect(
      await database.stock.findFirstOrThrow({
        where: { chatConfigId: chat.id, symbol: 'AMD' },
      }),
    ).toMatchObject({
      monitoringTier: 'INVESTIGATE',
      monitoringMode: 'HIGH_RESOLUTION',
      attentionScore: 80,
    });
  });

  it('persists advanced positioning snapshots and creates cautious anomaly events', async () => {
    const chat = await store.ensureChat('STOCKS', 889n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const observedAt = new Date('2026-09-05T12:00:00Z');
    const advancedItems: WatchItem[] = [
      {
        ...watchItem('options-advanced'),
        id: 'ALPHA_VANTAGE_OPTIONS:options-advanced',
        source: 'ALPHA_VANTAGE_OPTIONS',
        externalId: 'options-advanced',
        title: 'MU options positioning snapshot',
        publishedAt: observedAt,
        eventAt: observedAt,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        category: 'OPTIONS_SNAPSHOT',
        normalizedFacts: {
          callVolume: 2_000,
          putVolume: 1_000,
          callOpenInterest: 1_000,
          putOpenInterest: 2_000,
          putCallVolumeRatio: 0.5,
          putCallOpenInterestRatio: 2,
          meanImpliedVolatility: 0.42,
          maxVolumeOiRatio: 2.5,
        },
        metadata: { symbol: 'MU' },
      },
      {
        ...watchItem('institutional-advanced'),
        id: 'ALPHA_VANTAGE_INSTITUTIONAL:institutional-advanced',
        source: 'ALPHA_VANTAGE_INSTITUTIONAL',
        externalId: 'institutional-advanced',
        title: 'MU institutional positioning snapshot',
        publishedAt: observedAt,
        eventAt: observedAt,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        category: 'INSTITUTIONAL_POSITIONING',
        normalizedFacts: {
          totalShares: 1_000_000,
          totalValueUsd: 150_000_000,
          netShareChange: 60_000,
          changePercent: 6,
          holderCount: 400,
          topHolders: [{ holder: 'Example Fund', shares: 100_000 }],
        },
        metadata: { symbol: 'MU' },
      },
      {
        ...watchItem('short-interest-advanced'),
        id: 'FINRA_SHORT_INTEREST:short-interest-advanced',
        source: 'FINRA_SHORT_INTEREST',
        externalId: 'short-interest-advanced',
        title: 'MU FINRA short interest',
        publishedAt: observedAt,
        eventAt: observedAt,
        sourceType: 'REGULATORY',
        primarySource: true,
        category: 'SHORT_INTEREST_SNAPSHOT',
        normalizedFacts: {
          currentShortPosition: 25_000_000,
          previousShortPosition: 20_000_000,
          changeShares: 5_000_000,
          changePercent: 25,
          averageDailyVolume: 4_000_000,
          daysToCover: 6.25,
        },
        metadata: { symbol: 'MU' },
      },
    ];

    await store.prepareItemsForRun('STOCKS', run.id, advancedItems, 10);

    await expect(database.optionsSnapshot.count()).resolves.toBe(1);
    await expect(database.institutionalSnapshot.count()).resolves.toBe(1);
    await expect(database.shortInterestSnapshot.count()).resolves.toBe(1);
    expect(
      (
        await database.canonicalEvent.findMany({
          select: { eventType: true, direction: true },
        })
      ).map(({ eventType }) => eventType),
    ).toEqual(
      expect.arrayContaining([
        'OPTIONS_ANOMALY',
        'INSTITUTIONAL_POSITIONING',
        'SHORT_INTEREST_CHANGE',
      ]),
    );
    expect(
      await database.canonicalEvent.findFirstOrThrow({
        where: { eventType: 'OPTIONS_ANOMALY' },
      }),
    ).toMatchObject({ direction: 'UNKNOWN', materiality: 'MEDIUM' });
  });

  it('persists and lists dated catalysts for watched companies', async () => {
    const chat = await store.ensureChat('STOCKS', 789n);
    await database.stock.create({
      data: { chatConfigId: chat.id, symbol: 'MU' },
    });
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const earnings: WatchItem = {
      ...watchItem('earnings-date'),
      source: 'EARNINGS_WHISPERS',
      externalId: 'earnings-date',
      title: 'MU upcoming earnings',
      sourceType: 'ANALYST',
      primarySource: false,
      category: 'EARNINGS',
      normalizedFacts: { nextEarningsDate: '2026-09-30T20:00:00Z' },
    };

    await store.prepareItemsForRun('STOCKS', run.id, [earnings], 5);

    await expect(store.listCatalysts(chat.id, 'MU')).resolves.toMatchObject([
      {
        ticker: 'MU',
        catalystType: 'EARNINGS',
        expectedStart: new Date('2026-09-30T20:00:00Z'),
        exactDateKnown: true,
        status: 'UPCOMING',
      },
    ]);
  });

  it('deduplicates the same SEC event reported by a second source', async () => {
    const firstChat = await store.ensureChat('STOCKS', 781n);
    const firstRun = await store.claimRun(
      firstChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!firstRun) throw new Error('Expected first run');
    const url =
      'https://www.sec.gov/Archives/edgar/data/723125/000110465926101067/primary.xml';
    const filing: WatchItem = {
      ...watchItem('sec-event'),
      title: 'Micron Form 144 proposed sale',
      url,
      category: 'INSIDER_TRANSACTION',
      normalizedFacts: { form: '144' },
    };
    await store.prepareItemsForRun('STOCKS', firstRun.id, [filing], 5);

    const secondChat = await store.ensureChat('STOCKS', 782n);
    const secondRun = await store.claimRun(
      secondChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!secondRun) throw new Error('Expected second run');
    await store.prepareItemsForRun(
      'STOCKS',
      secondRun.id,
      [
        {
          ...filing,
          id: 'FINVIZ:event',
          source: 'FINVIZ',
          externalId: 'event',
          title: 'MU insider proposed sale',
          primarySource: false,
        },
      ],
      5,
    );

    expect(await database.canonicalEvent.count()).toBe(1);
    expect(await database.eventObservation.count()).toBe(2);
    expect(await store.getRunIntelligenceSummary(secondRun.id)).toMatchObject({
      newEventCount: 0,
      duplicateEventCount: 1,
    });
  });

  it('serializes concurrent semantic event deduplication', async () => {
    const firstChat = await store.ensureChat('STOCKS', 784n);
    const secondChat = await store.ensureChat('STOCKS', 785n);
    const [firstRun, secondRun] = await Promise.all([
      store.claimRun(firstChat.watcherConfig!.id, 'MANUAL'),
      store.claimRun(secondChat.watcherConfig!.id, 'MANUAL'),
    ]);
    if (!firstRun || !secondRun) throw new Error('Expected runs');
    const base: WatchItem = {
      ...watchItem('deal-one'),
      title: 'Micron announces major acquisition of Sample Corp',
      url: 'https://investors.example.com/deal',
      content: 'Micron entered a definitive merger agreement.',
      source: 'INVESTOR_RELATIONS',
      sourceType: 'INVESTOR_RELATIONS',
      category: 'COMPANY_EVENT',
    };

    await Promise.all([
      store.prepareItemsForRun('STOCKS', firstRun.id, [base], 5),
      store.prepareItemsForRun(
        'STOCKS',
        secondRun.id,
        [
          {
            ...base,
            id: 'NEWS:deal-two',
            externalId: 'deal-two',
            source: 'NEWS',
            sourceType: 'NEWS',
            primarySource: false,
            title: 'Micron major acquisition of Sample Corp announced',
            url: 'https://news.example.com/deal',
          },
        ],
        5,
      ),
    ]);

    expect(await database.canonicalEvent.count()).toBe(1);
    expect(await database.eventObservation.count()).toBe(2);
  });

  it('links downstream analyst interpretation to the primary event chain', async () => {
    const chat = await store.ensureChat('STOCKS', 786n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const driver: WatchItem = {
      ...watchItem('driver'),
      title: 'Micron announces acquisition',
      content: 'Micron entered a definitive merger agreement.',
      url: 'https://investors.example.com/driver',
      source: 'INVESTOR_RELATIONS',
      sourceType: 'INVESTOR_RELATIONS',
      category: 'COMPANY_EVENT',
    };
    const interpretation: WatchItem = {
      ...watchItem('interpretation'),
      title: 'MU analyst rank update',
      content: 'Analyst rank changed after the transaction.',
      url: 'https://analyst.example.com/mu',
      source: 'ZACKS',
      sourceType: 'ANALYST',
      primarySource: false,
      category: 'ANALYST_SNAPSHOT',
    };

    await store.prepareItemsForRun('STOCKS', run.id, [driver], 5);
    await store.prepareItemsForRun('STOCKS', run.id, [interpretation], 5);

    const events = await database.canonicalEvent.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      eventType: 'ANALYST_REVISION',
      primaryDriverId: events[0]!.id,
      chainId: events[0]!.chainId,
    });
  });

  it('backs off repeatedly failing sources and recovers after success', async () => {
    const chat = await store.ensureChat('STOCKS', 783n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const now = new Date('2026-09-04T10:00:00Z');

    await store.recordSourceFailure(
      'STOCKS',
      run.id,
      'NEWS',
      'MU',
      'HTTP 429 rate limit',
      now,
    );
    expect(
      await store.sourceAttemptDecision(
        'STOCKS',
        run.id,
        'NEWS',
        'MU',
        new Date(now.getTime() + 1_000),
      ),
    ).toMatchObject({ allowed: false, status: 'RATE_LIMITED' });

    await store.recordSourceSuccess(
      'STOCKS',
      run.id,
      'NEWS',
      'MU',
      new Date(now.getTime() + 2_000),
    );
    expect(
      await store.sourceAttemptDecision(
        'STOCKS',
        run.id,
        'NEWS',
        'MU',
        new Date(now.getTime() + 3_000),
      ),
    ).toEqual({ allowed: true, status: 'HEALTHY' });
  });

  it('shares provider rate-limit backoff across targets and honors Retry-After', async () => {
    const chat = await store.ensureChat('STOCKS', 793n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const now = new Date('2026-09-04T10:00:00Z');
    const retryAt = new Date('2026-09-04T10:02:00Z');
    const context = {
      sharedRateLimitBackoff: true,
      rateLimited: true,
      retryAt,
    };

    await store.recordSourceFailure(
      'STOCKS',
      run.id,
      'NEWS',
      'MU',
      'HTTP 429 rate limit',
      now,
      context,
    );
    const snapshot = await store.getObservabilitySnapshot(
      chat.watcherConfig!.id,
    );
    expect(snapshot.sourceHealth).not.toContainEqual(
      expect.objectContaining({ target: '__PROVIDER__' }),
    );
    await expect(
      store.claimReconciliation(
        chat.watcherConfig!.id,
        new Date(now.getTime() + 500),
      ),
    ).resolves.toBe(true);
    const otherChat = await store.ensureChat('STOCKS', 794n);
    const otherRun = await store.claimRun(
      otherChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!otherRun) throw new Error('Expected second run');

    await expect(
      store.sourceAttemptDecision(
        'STOCKS',
        otherRun.id,
        'NEWS',
        'NVDA',
        new Date(now.getTime() + 1_000),
        context,
      ),
    ).resolves.toMatchObject({
      allowed: false,
      status: 'RATE_LIMITED',
      retryAt,
    });

    await store.recordSourceSuccess(
      'STOCKS',
      otherRun.id,
      'NEWS',
      'NVDA',
      new Date(retryAt.getTime() + 1_000),
      context,
    );
    await expect(
      store.sourceAttemptDecision(
        'STOCKS',
        otherRun.id,
        'NEWS',
        'AAPL',
        new Date(retryAt.getTime() + 2_000),
        context,
      ),
    ).resolves.toEqual({ allowed: true, status: 'HEALTHY' });
  });

  it('treats legacy target rate limits as provider-wide backoff', async () => {
    const firstChat = await store.ensureChat('STOCKS', 795n);
    const firstRun = await store.claimRun(
      firstChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!firstRun) throw new Error('Expected first run');
    const now = new Date('2026-09-04T11:00:00Z');
    const retryAt = new Date('2026-09-04T11:10:00Z');
    await store.recordSourceFailure(
      'STOCKS',
      firstRun.id,
      'NEWS',
      'MU',
      'HTTP 429 rate limit',
      now,
      {
        sharedRateLimitBackoff: false,
        rateLimited: true,
        retryAt,
      },
    );

    const secondChat = await store.ensureChat('STOCKS', 796n);
    const secondRun = await store.claimRun(
      secondChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!secondRun) throw new Error('Expected second run');

    await expect(
      store.sourceAttemptDecision(
        'STOCKS',
        secondRun.id,
        'NEWS',
        'NVDA',
        new Date(now.getTime() + 1_000),
        { sharedRateLimitBackoff: true },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      status: 'RATE_LIMITED',
      retryAt,
    });
  });

  it('persists company universe state and lifecycle events', async () => {
    const chat = await store.ensureChat('STOCKS', 778n);
    const created = await universe.createCompany({
      chatConfigId: chat.id,
      ticker: 'MU',
      companyName: 'Micron Technology, Inc.',
      cik: '0000723125',
      exchange: 'Nasdaq',
      sector: null,
      industry: 'Semiconductors',
      marketCap: null,
      currency: 'USD',
      country: 'US',
      investorRelationsUrl: 'https://investors.micron.com/',
      enabled: true,
      monitoringTier: 'WATCH',
      monitoringMode: 'NORMAL',
      priority: 50,
      tags: [],
      watchReason: null,
      watchUntil: null,
    });
    const updated = await universe.updateCompanyState(created.id, {
      monitoringTier: 'CORE',
      monitoringMode: 'HIGH_RESOLUTION',
      priority: 90,
      watchReason: 'Owned position',
    });

    expect(updated).toMatchObject({
      ticker: 'MU',
      monitoringTier: 'CORE',
      monitoringMode: 'HIGH_RESOLUTION',
      priority: 90,
      watchReason: 'Owned position',
    });
    expect((await eventJournal.list()).map(({ type }) => type)).toEqual([
      'company.added',
      'company.state_changed',
    ]);
  });

  it('activates, promotes, and expires an auto-discovered company', async () => {
    const now = new Date('2026-09-04T10:00:00Z');
    const chat = await store.ensureChat('STOCKS', 880n);
    const scan = await discovery.claimScan(
      chat.watcherConfig!.id,
      'SCHEDULED',
      'DAILY',
      now,
    );
    if (!scan) throw new Error('Expected discovery scan');
    const candidate: DiscoveryCandidate = {
      ticker: 'MU',
      price: 150,
      changePercent: 6.5,
      volume: 2_000_000,
      dollarVolume: 300_000_000,
      attentionScore: 78,
      observedAt: now,
      snapshotId: '2026-09-04 close',
      source: 'ALPHA_VANTAGE_MARKET_MOVERS',
      trigger: 'PRICE_MOVE',
      reason: '+6.50% price move on 2,000,000 shares',
      fingerprint: 'discovery-fingerprint',
    };
    const profile = {
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
      cik: '0000723125',
      exchange: 'Nasdaq',
      industry: 'Semiconductors',
      investorRelationsUrl: 'https://investors.micron.com/',
    };

    await expect(
      discovery.activateCandidate(
        chat.watcherConfig!.id,
        scan.id,
        candidate,
        profile,
        now,
      ),
    ).resolves.toEqual({ activated: true, ticker: 'MU' });
    await expect(
      discovery.activateCandidate(
        chat.watcherConfig!.id,
        scan.id,
        candidate,
        profile,
        now,
      ),
    ).resolves.toEqual({ activated: false, ticker: 'MU' });
    const investigating = await database.stock.findFirstOrThrow({
      where: { chatConfigId: chat.id, symbol: 'MU' },
      include: { sources: true },
    });
    expect(investigating).toMatchObject({
      autoDiscovered: true,
      monitoringTier: 'INVESTIGATE',
      monitoringMode: 'HIGH_RESOLUTION',
      attentionScore: 78,
    });
    expect(investigating.sources).toHaveLength(19);
    expect(investigating.sources.every(({ enabled }) => enabled)).toBe(true);

    await discovery.promoteMaterialEvents(
      chat.id,
      {
        events: [
          {
            eventId: 'event-1',
            ticker: 'MU',
            eventType: 'ACQUISITION',
            title: 'Micron announces a major acquisition',
            materiality: 'HIGH',
            action: 'FULL_ANALYSIS',
            decision: 'DUPLICATE',
          },
        ],
        newEventCount: 0,
        duplicateEventCount: 1,
        storedOnlyCount: 0,
        cooldownCount: 0,
      },
      now,
    );
    expect(
      await database.stock.findUniqueOrThrow({
        where: { id: investigating.id },
      }),
    ).toMatchObject({
      monitoringTier: 'WATCH',
      monitoringMode: 'EVENT_MODE',
      attentionScore: 90,
      watchStartedAt: now,
    });

    await discovery.reconcileExpired(new Date('2026-09-04T12:01:00Z'));
    expect(
      await database.stock.findUniqueOrThrow({
        where: { id: investigating.id },
      }),
    ).toMatchObject({ monitoringTier: 'WATCH', monitoringMode: 'NORMAL' });
    await discovery.reconcileExpired(new Date('2026-09-18T10:01:00Z'));
    expect(
      await database.stock.findUniqueOrThrow({
        where: { id: investigating.id },
      }),
    ).toMatchObject({
      monitoringTier: 'DISCOVERY',
      monitoringMode: 'LOW_RESOLUTION',
      watchUntil: null,
    });

    const configured = await universe.createCompany({
      chatConfigId: chat.id,
      ticker: 'AMD',
      companyName: 'Advanced Micro Devices, Inc.',
      cik: '0000002488',
      exchange: 'Nasdaq',
      sector: null,
      industry: 'Semiconductors',
      marketCap: null,
      currency: 'USD',
      country: 'US',
      investorRelationsUrl: 'https://ir.amd.com/',
      enabled: true,
      monitoringTier: 'WATCH',
      monitoringMode: 'NORMAL',
      priority: 50,
      tags: [],
      watchReason: null,
      watchUntil: null,
    });
    await discovery.promoteMaterialEvents(
      chat.id,
      {
        events: [
          {
            eventId: 'event-2',
            ticker: 'AMD',
            eventType: 'GUIDANCE',
            title: 'AMD materially raises guidance',
            materiality: 'HIGH',
            action: 'FULL_ANALYSIS',
            decision: 'ANALYZE',
          },
        ],
        newEventCount: 1,
        duplicateEventCount: 0,
        storedOnlyCount: 0,
        cooldownCount: 0,
      },
      now,
    );
    expect(
      await database.stock.findUniqueOrThrow({
        where: { id: configured.id },
      }),
    ).toMatchObject({
      monitoringTier: 'WATCH',
      monitoringMode: 'EVENT_MODE',
      watchUntil: null,
    });
  });

  it('bulk-adds publication queries and skips duplicates', async () => {
    const chat = await store.ensureChat('PUBLICATIONS', 123n);

    const first = await store.addQueries(chat.id, [
      'mycorrhizal fungi',
      'plant microbiome',
      'MYCORRHIZAL FUNGI',
    ]);
    const second = await store.addQueries(chat.id, [
      'mycorrhizal fungi',
      'soil carbon',
    ]);
    const queries = await store.listQueries(chat.id);

    expect(first).toEqual({ addedCount: 2, skippedCount: 0, totalCount: 2 });
    expect(second).toEqual({ addedCount: 1, skippedCount: 1, totalCount: 2 });
    expect(queries.map((entry) => entry.query).sort()).toEqual([
      'mycorrhizal fungi',
      'plant microbiome',
      'soil carbon',
    ]);
    expect(
      queries.every(
        (entry) =>
          entry.sources.length === 4 &&
          entry.sources.every(({ enabled }) => enabled),
      ),
    ).toBe(true);
  });

  it('enables every publication source for a new single query', async () => {
    const chat = await store.ensureChat('PUBLICATIONS', 124n);

    const query = await store.addQuery(chat.id, 'soil microbiome');

    expect(query.sources).toHaveLength(4);
    expect(query.sources.every(({ enabled }) => enabled)).toBe(true);
  });

  it('serializes Ollama leases across database sessions', async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const order: string[] = [];
    const first = store.withOllamaLease(async () => {
      order.push('first-start');
      markStarted?.();
      await waiting;
      order.push('first-end');
    });
    await started;
    const second = store.withOllamaLease(async () => {
      order.push('second');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(order).toEqual(['first-start']);
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('serializes Ollama and speech generation on the shared local-model lease', async () => {
    const resources = new ResourceLeaseStore(database);
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const order: string[] = [];
    const analysis = store.withOllamaLease(async () => {
      order.push('analysis-start');
      markStarted?.();
      await waiting;
      order.push('analysis-end');
    });
    await started;
    const speech = resources.withExclusiveLease(
      'HEAVY_LOCAL_MODEL',
      async () => {
        order.push('speech');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(order).toEqual(['analysis-start']);
    release?.();
    await Promise.all([analysis, speech]);
    expect(order).toEqual(['analysis-start', 'analysis-end', 'speech']);
  });
});
