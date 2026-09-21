import { describe, expect, it } from 'vitest';
import { stockThesisStateSchema } from '@watcher/core';
import { isAuthorized, parseAllowedUserIds } from '../authorization.js';
import { escapeHtml, htmlText, optionalSourceLink } from '../utils/html.js';
import { parsePublicationQueriesCsv } from '../utils/input.js';
import {
  formatRunDuration,
  renderCatalystList,
  renderEarningsSnapshot,
  renderPublicationDigest,
  renderRunProgress,
  renderStockAlert,
  renderStockDashboard,
  renderStockDecisionCard,
  renderStockDigest,
  renderStockPeerMap,
  renderStockReaction,
  renderPaperPortfolio,
  renderStockValuation,
  renderWatcherHealth,
  splitTelegramMessage,
} from '../messages.js';
import {
  renderAdvancedStockData,
  renderPublicationSourceList,
  renderStockSourceList,
} from '../source-messages.js';

describe('Telegram utilities', () => {
  it('renders a peer map without asserting unverified supply-chain ties', () => {
    const text = renderStockPeerMap({
      ticker: 'MU',
      focus: 'DRAM, HBM, NAND and AI memory demand',
      peers: [
        {
          name: 'SK hynix',
          relationship: 'COMPETITIVE_PEER',
          role: 'HBM and DRAM memory peer',
          watchFor: 'HBM capacity and pricing',
        },
      ],
    });

    expect(text).toContain('<b>MU PEER MAP</b>');
    expect(text).toContain('competitive peer');
    expect(text).toContain('not an assertion of a customer, supplier');
  });

  it('renders stored valuation and consensus data without a valuation verdict', () => {
    const text = renderStockValuation({
      ticker: 'MU',
      companyName: 'Micron Technology',
      marketCapUsd: 160_000_000_000,
      price: {
        close: 145.23,
        observedAt: new Date('2026-09-21T08:00:00Z'),
        sourceUrl: 'https://stooq.com/q/?s=mu.us',
      },
      zacks: {
        forwardPe: 12.5,
        rank: 'Buy',
        observedAt: new Date('2026-09-21T07:00:00Z'),
        sourceUrl: 'https://www.zacks.com/stock/quote/MU',
      },
      earnings: {
        earningsDate: new Date('2026-09-30T00:00:00Z'),
        confirmedAt: null,
        fiscalQuarter: 4,
        quarterEnd: null,
        consensusEps: 31.17,
        whisperEps: null,
        revenueEstimate: 50_760_000_000,
      },
    });

    expect(text).toContain('<b>MU VALUATION &amp; CONSENSUS</b>');
    expect(text).toContain('Forward P/E: 12.5');
    expect(text).toContain('implied forward earnings yield 8.0%');
    expect(text).toContain('Market capitalization: $160.00bn');
    expect(text).toContain('not a valuation verdict');
    expect(text).toContain('not real-time quotes');
  });

  it('renders a price-reaction guard without asserting causal certainty', () => {
    const text = renderStockReaction({
      ticker: 'MU',
      event: {
        title: 'Micron reports earnings',
        eventType: 'EARNINGS',
        materiality: 'HIGH',
        detectedAt: new Date('2026-09-21T12:00:00Z'),
        occurredAt: new Date('2026-09-21T11:30:00Z'),
        source: 'EARNINGS_WHISPERS',
        sourceUrl: 'https://www.earningswhispers.com/stocks/MU',
      },
      baseline: {
        close: 100,
        observedAt: new Date('2026-09-21T11:00:00Z'),
      },
      reaction: {
        close: 106,
        observedAt: new Date('2026-09-21T12:15:00Z'),
        dailyReturnPercent: 6,
        relativeVolume: 2.4,
        priceAnomaly: true,
        volumeAnomaly: true,
        unexplained: false,
        primaryDriverId: 'event-id',
      },
      status: 'CONFIRMED',
    });

    expect(text).toContain('<b>MU PRICE-REACTION GUARD</b>');
    expect(text).toContain('Change from stored baseline: +6.00%');
    expect(text).toContain('explicitly linked to this event');
    expect(text).toContain('not causality or a durable trend');
  });

  it('renders paper positions as a no-execution research ledger', () => {
    const text = renderPaperPortfolio([
      {
        id: 'paper-1',
        ticker: 'MU',
        status: 'OPEN',
        openedAt: new Date('2026-09-21T12:00:00Z'),
        closedAt: null,
        horizonDays: 30,
        amountCzk: 10_000,
        entryPrice: 100,
        entryPriceObservedAt: new Date('2026-09-21T12:00:00Z'),
        exitPrice: null,
        exitPriceObservedAt: null,
        latestPrice: 105,
        latestPriceObservedAt: new Date('2026-09-22T12:00:00Z'),
        returnPercent: 5,
        notionalProfitCzk: 500,
        horizonElapsed: false,
        thesis: { verdict: 'WATCH', confidence: 0.6, attentionScore: 70 },
      },
    ]);

    expect(text).toContain('<b>PAPER PORTFOLIO</b>');
    expect(text).toContain('Paper result: +5.00% · +500 Kč');
    expect(text).toContain('Open-position numbers are for /paper_close NUMBER');
    expect(text).toContain('never places an order');
  });

  it('renders an earnings setup and latest result without implying a trade action', () => {
    const text = renderEarningsSnapshot({
      ticker: 'MU',
      source: 'EARNINGS_WHISPERS',
      sourceUrl: 'https://www.earningswhispers.com/stocks/MU',
      observedAt: new Date('2026-09-20T10:00:00Z'),
      upcoming: {
        earningsDate: new Date('2026-09-30T00:00:00Z'),
        confirmedAt: new Date('2026-08-26T00:00:00Z'),
        fiscalQuarter: 4,
        quarterEnd: new Date('2026-08-31T00:00:00Z'),
        consensusEps: 31.17,
        whisperEps: null,
        revenueEstimate: 50_760,
      },
      latest: {
        earningsDate: new Date('2026-06-24T00:00:00Z'),
        fiscalPeriod: 'fiscal third quarter',
        actualEps: 24.89,
        consensusEps: 20.98,
        whisperEps: 22.15,
        lowEpsEstimate: 19.1,
        highEpsEstimate: 26,
        epsSurprise: 0.1237,
        actualRevenue: 41_456,
        revenueEstimate: 34_980,
        revenueSurprise: 0.1851,
      },
    });

    expect(text).toContain('<b>MU EARNINGS</b>');
    expect(text).toContain('Next setup');
    expect(text).toContain('actual 24.89 vs consensus 20.98 · beat +3.91');
    expect(text).toContain('actual 41,456 USDm vs consensus 34,980 USDm');
    expect(text).toContain('What it means');
    expect(text).toContain('positive historical operating momentum');
    expect(text).toContain('Is buying supported by the current research?');
    expect(text).toContain('This earnings snapshot alone is not enough');
    expect(text).toContain(
      'not personal financial advice or a trade instruction',
    );
  });

  it('escapes and truncates shared HTML output safely', () => {
    expect(escapeHtml('<A&B "quote">')).toBe(
      '&lt;A&amp;B &quot;quote&quot;&gt;',
    );
    expect(htmlText('  A   &   B  ', 9)).toBe('A &amp; …');
    expect(optionalSourceLink('SEC', 'https://www.sec.gov/')).toBe(
      '<a href="https://www.sec.gov/">SEC</a>',
    );
    expect(optionalSourceLink('SEC', 'not a URL')).toBe('SEC');
  });

  it('authorizes only configured user IDs', () => {
    const ids = parseAllowedUserIds('123, 456');
    expect(isAuthorized(ids, 123)).toBe(true);
    expect(isAuthorized(ids, 999)).toBe(false);
    expect(isAuthorized(ids, undefined)).toBe(false);
  });

  it('rejects invalid allowlist values', () => {
    expect(() => parseAllowedUserIds('123,nope')).toThrow(
      'Invalid Telegram user ID',
    );
  });

  it('parses publication queries from CSV content', () => {
    expect(
      parsePublicationQueriesCsv(
        'query,notes\nmycorrhizal fungi,soil\n"plant, microbe",quoted\nMYCORRHIZAL FUNGI,duplicate',
      ),
    ).toEqual(['mycorrhizal fungi', 'plant, microbe']);
  });

  it('splits messages without exceeding Telegram limits', () => {
    const parts = splitTelegramMessage(
      `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`,
      80,
    );
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.length <= 80)).toBe(true);
  });

  it('formats run durations for Telegram output', () => {
    expect(formatRunDuration(499)).toBe('0s');
    expect(formatRunDuration(61_000)).toBe('1m 1s');
    expect(formatRunDuration(3_661_000)).toBe('1h 1m 1s');
  });

  it('renders manual run progress with a fixed width bar', () => {
    expect(
      renderRunProgress({
        percent: 60,
        step: 'Analyzing fundamentals',
      }),
    ).toBe(
      '⏳ Processing request...\n[██████░░░░] 60%\nCurrent step: Analyzing fundamentals',
    );
  });

  it('renders source lists with provider links', () => {
    expect(renderStockSourceList()).toContain(
      '<a href="https://www.sec.gov/edgar/searchedgar/companysearch">SEC EDGAR</a>',
    );
    expect(renderStockSourceList()).toContain(
      '<a href="https://finviz.com/insidertrading.ashx">FINVIZ Insider Trading</a>',
    );
    expect(renderStockSourceList()).toContain(
      '<a href="https://www.tradingview.com/news/">TradingView News</a>',
    );
    expect(renderStockSourceList()).toContain(
      '<a href="https://www.alphavantage.co/">Alpha Vantage Market Movers</a>',
    );
    expect(renderStockSourceList()).toContain(
      '<a href="https://www.quiverquant.com/">Quiver Quantitative</a>',
    );
    expect(renderPublicationSourceList()).toContain(
      '<a href="https://pubmed.ncbi.nlm.nih.gov/">PubMed</a>',
    );
    expect(renderPublicationSourceList()).toContain(
      '<a href="https://clinicaltrials.gov/">ClinicalTrials.gov</a>',
    );
  });

  it('renders the catalyst registry with timing and evidence', () => {
    expect(
      renderCatalystList([
        {
          ticker: 'MU',
          catalystType: 'EARNINGS',
          description: 'Quarterly earnings',
          expectedStart: new Date('2026-09-30T20:00:00Z'),
          expectedEnd: null,
          exactDateKnown: true,
          proximity: 'MEDIUM',
          impact: 'HIGH',
          direction: 'UNKNOWN',
          status: 'UPCOMING',
          event: {
            primaryEvidence: {
              source: 'EARNINGS_WHISPERS',
              sourceUrl: 'https://www.earningswhispers.com/stocks/MU',
              primarySource: false,
            },
          },
        },
      ]),
    ).toContain(
      '📆 2026-09-30 · exact date\nUPCOMING · MEDIUM proximity · HIGH impact · UNKNOWN direction',
    );
  });

  it('renders advanced positioning and regulatory data', () => {
    const text = renderAdvancedStockData([
      {
        symbol: 'MU',
        companyName: 'Micron Technology',
        options: {
          observedAt: new Date('2026-09-05T00:00:00Z'),
          callVolume: 2_000n,
          putVolume: 1_000n,
          putCallVolumeRatio: 0.5,
          putCallOpenInterestRatio: 1.2,
          meanImpliedVolatility: 0.42,
          maxVolumeOiRatio: 2.5,
          anomaly: true,
        },
        institutional: null,
        shortInterest: {
          settlementDate: new Date('2026-08-31T00:00:00Z'),
          currentShortPosition: 25_000_000n,
          changePercent: 25,
          daysToCover: 6.25,
          materialChange: true,
        },
        regulatoryEvents: [
          {
            eventType: 'FDA_DECISION',
            title: 'FDA submission update',
            materiality: 'HIGH',
            firstDetectedAt: new Date('2026-09-05T01:00:00Z'),
            primaryEvidence: {
              source: 'FDA',
              sourceUrl: 'https://open.fda.gov/example',
              url: 'https://open.fda.gov/example',
            },
          },
        ],
      },
    ]);

    expect(text).toContain('MU — Micron Technology');
    expect(text).toContain('<b>Options</b> · 2026-09-05 · ⚠️ anomaly');
    expect(text).toContain('Position: 25,000,000');
    expect(text).toContain(
      '<a href="https://open.fda.gov/example">FDA submission update</a>',
    );
  });

  it('renders stock digest entries with isolated URLs', () => {
    const text = renderStockDigest({
      durationMs: 366_000,
      fetchedCount: 2,
      newItemCount: 2,
      analyzedCount: 2,
      failedAnalysisCount: 0,
      sourceFailures: [],
      intelligence: {
        newEventCount: 1,
        duplicateEventCount: 1,
        storedOnlyCount: 0,
        cooldownCount: 0,
        events: [
          {
            eventId: 'event-1',
            ticker: 'MU',
            eventType: 'MANAGEMENT_CHANGE',
            title: 'Micron leadership update',
            sourceUrl:
              'https://www.sec.gov/Archives/edgar/data/1/leadership.htm',
            materiality: 'MEDIUM',
            action: 'TARGETED_ANALYSIS',
            decision: 'ANALYZE',
          },
        ],
      },
      analyses: [
        {
          item: {
            id: 'SEC:1',
            source: 'SEC',
            externalId: '1',
            title: 'Micron filing',
            url: 'https://www.sec.gov/Archives/edgar/data/1/a.htm',
            content: 'content',
            metadata: { target: 'MU' },
          },
          outcome: {
            status: 'SUCCESS',
            result: {
              title: 'Leadership update',
              summary: 'Executive role changes were announced.',
              importance: 8,
              sentiment: 'neutral',
              eventType: '8-K',
              positives: [],
              negatives: [],
              risks: [],
              catalysts: [],
              confidence: 0.8,
            },
          },
        },
        {
          item: {
            id: 'SEC:2',
            source: 'SEC',
            externalId: '2',
            title: 'Micron ownership filing',
            url: 'https://www.sec.gov/Archives/edgar/data/1/b.xml',
            content: 'content',
            metadata: { target: 'MU' },
          },
          outcome: {
            status: 'SUCCESS',
            result: {
              title: 'Ownership filing',
              summary: 'A routine ownership filing was submitted.',
              importance: 3,
              sentiment: 'neutral',
              eventType: 'Form 4',
              positives: [],
              negatives: [],
              risks: [],
              catalysts: [],
              confidence: 0.8,
            },
          },
        },
      ],
    });

    expect(text).toContain('<b>1. MU</b>');
    expect(text).toContain('⚪ <b>Sentiment:</b> neutral');
    expect(text).toContain('⏱ <b>Run time:</b> 6m 6s');
    expect(text).toContain('🧭 <b>Event processing</b>');
    expect(text).toContain('1 new · 1 duplicates');
    expect(text).toContain(
      '<a href="https://www.sec.gov/Archives/edgar/data/1/leadership.htm">Micron leadership update</a>',
    );
    expect(text).toContain(
      '<a href="https://www.sec.gov/Archives/edgar/data/1/a.htm">SEC</a>\n\n──────────\n\n<b>2. MU</b>',
    );
  });

  it('renders publication digests as escaped, structured Telegram HTML', () => {
    const text = renderPublicationDigest({
      durationMs: 900_000,
      fetchedCount: 1,
      newItemCount: 1,
      analyzedCount: 1,
      failedAnalysisCount: 0,
      sourceFailures: [],
      analyses: [
        {
          item: {
            id: 'PUBMED:1',
            source: 'PUBMED',
            externalId: '1',
            title: 'Source title',
            url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
            content: 'content',
            metadata: { target: 'fungi & soil' },
          },
          outcome: {
            status: 'SUCCESS',
            result: {
              title: 'Plant < microbe interactions',
              summary: 'A concise & useful summary.',
              importance: 8,
              relevance: 9,
              keyFindings: ['One finding', 'Second finding'],
              methods: ['Review'],
              limitations: ['Limited field evidence'],
              whyInteresting: 'It informs agricultural practice.',
              confidence: 0.9,
            },
          },
        },
      ],
    });

    expect(text).toContain('🧬 <b>PUBLICATIONS WATCHER</b>');
    expect(text).toContain('⏱ <b>Run time:</b> 15m 0s');
    expect(text).toContain('<b>1. Plant &lt; microbe interactions</b>');
    expect(text).toContain('🎯 <b>Topic:</b> fungi &amp; soil');
    expect(text).toContain('🔑 <b>Key findings</b>\n• One finding');
    expect(text).toContain(
      '<a href="https://pubmed.ncbi.nlm.nih.gov/1/">PUBMED</a>',
    );
  });

  it('renders escaped publication analysis failures', () => {
    const text = renderPublicationDigest({
      fetchedCount: 1,
      newItemCount: 1,
      analyzedCount: 0,
      failedAnalysisCount: 1,
      sourceFailures: [],
      analyses: [
        {
          item: {
            id: 'PUBMED:1',
            source: 'PUBMED',
            externalId: '1',
            title: 'Fungi < soil',
            url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
            content: 'content',
            metadata: { target: 'fungi' },
          },
          outcome: {
            status: 'FAILED',
            error: 'Ollama returned HTTP 400: bad <schema>',
          },
        },
      ],
    });

    expect(text).toContain('⚠️ <b>Analysis errors</b>');
    expect(text).toContain('Fungi &lt; soil');
    expect(text).toContain('bad &lt;schema&gt;');
  });

  it('groups one provider failure shared by many publication queries', () => {
    const text = renderPublicationDigest({
      fetchedCount: 0,
      newItemCount: 0,
      analyzedCount: 0,
      failedAnalysisCount: 0,
      analyses: [],
      sourceFailures: ['aging', 'genomics', 'microbiome'].map((target) => ({
        source: 'BIORXIV',
        target,
        message: 'Invalid JSON response from api.biorxiv.org',
      })),
    });

    expect(text).toContain(
      '<b>BIORXIV</b> · 3 queries (aging, genomics, microbiome)',
    );
    expect(text.match(/Invalid JSON response/g)).toHaveLength(1);
  });

  it('renders live alerts with evidence and a safety qualification', () => {
    const text = renderStockAlert({
      ticker: 'MU',
      type: 'UNEXPLAINED_ACTIVITY',
      severity: 'HIGH',
      title: 'Unexplained market anomaly — MU',
      reasons: ['No confirmed public primary driver.'],
      snapshot: {
        verdict: 'WATCH',
        attentionScore: 90,
        netSignal: 1.5,
        thesisChange: 'IMPROVED',
        dataCoverage: 80,
        recommendation: 'WATCH',
        expectedValuePercent: 4,
        pricedIn: 'UNKNOWN',
      },
      createdAt: new Date(),
      sentAt: null,
      event: {
        primaryEvidence: {
          source: 'SEC',
          sourceUrl: 'https://www.sec.gov/Archives/example',
          url: 'https://www.sec.gov/Archives/example',
        },
      },
    });

    expect(text).toContain('🔔 <b>STOCK ALERT · HIGH</b>');
    expect(text).toContain(
      'No information leak or guaranteed trade is inferred',
    );
    expect(text).toContain(
      '<a href="https://www.sec.gov/Archives/example">SEC</a>',
    );
  });

  it('renders the stock dashboard and watcher health', () => {
    const dashboard = renderStockDashboard([
      {
        stock: {
          symbol: 'MU',
          companyName: 'Micron Technology, Inc.',
          monitoringTier: 'CORE',
          monitoringMode: 'EVENT_MODE',
          attentionScore: 90,
        },
        thesis: {
          verdict: 'WATCH',
          confidence: 0.8,
          attentionScore: 90,
          netSignal: 2,
          insiderConviction: 3,
          dataCoverage: 80,
          decision: {
            asymmetry: 'GOOD',
            probabilityHigher: {
              thirtyDays: { minimum: 55, maximum: 70 },
            },
          },
          updatedAt: new Date('2026-09-05T05:00:00Z'),
        },
        price: {
          close: '125.50',
          dailyReturnPercent: '4.25',
          observedAt: new Date('2026-09-05T04:00:00Z'),
        },
        catalyst: null,
        lastEvent: {
          eventType: 'EARNINGS',
          firstDetectedAt: new Date('2026-09-05T04:30:00Z'),
        },
        lastRevision: {
          thesisChange: 'IMPROVED',
          createdAt: new Date('2026-09-05T05:00:00Z'),
        },
      },
    ]);
    expect(dashboard).toContain('MU — Micron Technology, Inc.');
    expect(dashboard).toContain('EVENT_MODE');
    expect(dashboard).toContain('+4.25%');

    const health = renderWatcherHealth({
      runInProgress: false,
      lastSuccessfulPoll: null,
      lastRunStatus: 'SUCCESS',
      nextRunAt: null,
      lastReconciliationAt: null,
      nextReconciliationAt: null,
      reconciliationInProgress: false,
      pendingAlerts: 0,
      alertsGenerated: 1,
      duplicatesPrevented: 12,
      analysisQueueDepth: 0,
      sourceFailures: 1,
      failedAnalyses: 0,
      rateLimitedSources: 0,
      sourceCoveragePercent: 100,
      llmCalls: 3,
      promptTokens: 500,
      completionTokens: 200,
      averageAnalysisDurationMs: 1500,
      averageEventAnalysisLatencyMs: 2500,
      averageAlertDeliveryLatencyMs: 500,
      estimatedLlmCostUsd: 0,
      sourceHealth: [],
    });
    expect(health).toContain('Duplicates prevented: 12');
    expect(health).toContain('3 calls');
  });

  it('renders an evidence-linked buy candidate without treating it as an order', () => {
    const state = stockThesisStateSchema.parse({
      ticker: 'MU',
      thesis: 'Verified HBM demand supports the current thesis.',
      verdict: 'WATCH',
      confidence: 0.76,
      attentionScore: 84,
      bullScore: 3,
      bearScore: 1,
      netSignal: 2.5,
      signalGroups: [],
      catalysts: [],
      insiderConviction: null,
      pricedIn: 'PARTIALLY_PRICED_IN',
      primaryDrivers: ['HBM demand'],
      risks: ['Memory pricing can weaken.'],
      dataCoverage: 82,
      dataQuality: 'HIGH',
      materialDataGaps: [],
      decision: {
        recommendation: 'BUY',
        expectedValuePercent: 14.2,
        asymmetry: 'VERY_GOOD',
        probabilityHigher: {
          sevenDays: null,
          thirtyDays: { minimum: 55, maximum: 65 },
          ninetyDays: { minimum: 58, maximum: 70 },
          twelveMonths: null,
        },
        scenarios: {
          bull: {
            probabilityPercent: { minimum: 25, maximum: 35 },
            expectedReturnPercent: { minimum: 25, maximum: 40 },
            assumptions: [],
            requiredCatalysts: [],
            invalidationConditions: ['HBM demand fails to materialize.'],
          },
          base: {
            probabilityPercent: { minimum: 45, maximum: 55 },
            expectedReturnPercent: { minimum: 5, maximum: 15 },
            assumptions: [],
            requiredCatalysts: [],
            invalidationConditions: ['Guidance is reduced.'],
          },
          bear: {
            probabilityPercent: { minimum: 15, maximum: 25 },
            expectedReturnPercent: { minimum: -30, maximum: -10 },
            assumptions: [],
            requiredCatalysts: [],
            invalidationConditions: ['Memory pricing falls sharply.'],
          },
        },
        pricedIn: {
          classification: 'PARTIALLY_PRICED_IN',
          explanation: 'The market reflects part of the demand recovery.',
        },
        volatilityRisk: 'HIGH',
        binaryCatalystExposure: false,
        downsideExplanation: 'Memory pricing remains cyclical.',
        maxRecommendedPositionPercent: { minimum: 0.5, maximum: 2.4 },
        rationale: ['Evidence supports a conditional setup.'],
        humanReviewRequired: true,
      },
    });

    const card = renderStockDecisionCard({
      state,
      latestEvent: {
        event: {
          title: 'Micron raises HBM supply outlook',
          eventType: 'GUIDANCE',
          materiality: 'HIGH',
          firstDetectedAt: new Date('2026-09-20T12:00:00Z'),
        },
        evidence: {
          source: 'Investor relations',
          sourceUrl: 'https://investors.micron.com/news',
          url: 'https://investors.micron.com/news',
          primarySource: true,
          reliability: 0.95,
        },
        targeted: {
          materiality: 'HIGH',
          thesisChange: 'IMPROVED',
          informationChange: 'NEW_INFORMATION',
          reanalysisRequired: true,
          affectedSignalGroups: [],
          catalystChange: 'UPDATED',
          recommendationChange: true,
          primaryDriver: 'Higher HBM supply outlook.',
          explanation: 'Demand is improving.',
          risks: [],
          confidence: 0.8,
        },
        reliabilityWeight: 0.95,
        fullAnalysisPerformed: true,
      },
    });

    expect(card).toContain('<b>Action:</b> BUY_CANDIDATE · model BUY');
    expect(card).toContain('<b>Evidence:</b> STRONG');
    expect(card).toContain('IMPROVED · NEW_INFORMATION');
    expect(card).toContain(
      '<a href="https://investors.micron.com/news">Investor relations</a>',
    );
    expect(card).toContain('HBM demand fails to materialize.');
    expect(card).toContain('not a trade instruction');

    const earnings = renderEarningsSnapshot(
      {
        ticker: 'MU',
        source: 'EARNINGS_WHISPERS',
        sourceUrl: 'https://www.earningswhispers.com/stocks/MU',
        observedAt: new Date('2026-09-20T12:00:00Z'),
        upcoming: null,
        latest: null,
      },
      { research: state },
    );
    expect(earnings).toContain('The stored model is BUY');
    expect(earnings).toContain('research candidate, not an automatic buy');
    expect(earnings).toContain('Memory pricing can weaken.');
  });
});
