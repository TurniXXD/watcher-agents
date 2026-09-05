import { describe, expect, it, vi } from 'vitest';
import { normalizeObservation } from '@watcher/core';
import {
  CompanyUniverseManager,
  InProcessEventBus,
  assertCompanyTransition,
  discoveryCompanyIsEligible,
  effectiveSourceIntervalMs,
  extractCanonicalEvent,
  investigationExpiryDecision,
  selectDiscoveryCandidates,
  titleSimilarity,
  type CompanyUniverseRecord,
} from '../index.js';

const company: CompanyUniverseRecord = {
  id: 'company-1',
  chatConfigId: 'chat-1',
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
  monitoringTier: 'DISCOVERY',
  monitoringMode: 'LOW_RESOLUTION',
  priority: 50,
  tags: [],
  watchReason: null,
  watchUntil: null,
};

describe('stock intelligence foundation', () => {
  it('normalizes raw observations with distinct public and discovery times', () => {
    const publishedAt = new Date('2026-09-04T06:00:00Z');
    const discoveredAt = new Date('2026-09-04T06:03:00Z');
    const observation = normalizeObservation(
      'STOCKS',
      {
        id: 'SEC:1',
        source: 'SEC',
        externalId: '1',
        title: 'Material filing',
        url: 'https://www.sec.gov/example',
        publishedAt,
        content: 'Sourced filing facts.',
        sourceType: 'REGULATORY',
        primarySource: true,
        category: 'COMPANY_EVENT',
        reliability: 1,
        metadata: { symbol: 'mu' },
      },
      discoveredAt,
    );

    expect(observation).toMatchObject({
      ticker: 'MU',
      publishedAt,
      discoveredAt,
      primarySource: true,
      rawText: 'Sourced filing facts.',
    });
  });

  it('calculates adaptive intervals and clamps event mode to provider limits', () => {
    const capabilities = {
      sourceName: 'Price',
      sourceType: 'MARKET_DATA' as const,
      minimumIntervalMs: 60_000,
      preferredIntervalMs: 5 * 60_000,
      maximumIntervalMs: 60 * 60_000,
      supportsStreaming: false,
      costPerRequestUsd: 0,
      rateLimitPerMinute: 60,
      priority: 70,
    };
    expect(
      effectiveSourceIntervalMs(capabilities, {
        tier: 'DISCOVERY',
        mode: 'LOW_RESOLUTION',
        marketSession: 'OVERNIGHT',
        catalystProximity: 'NONE',
        attentionScore: 0,
      }),
    ).toBe(60 * 60_000);
    expect(
      effectiveSourceIntervalMs(capabilities, {
        tier: 'CORE',
        mode: 'EVENT_MODE',
        marketSession: 'REGULAR_SESSION',
        catalystProximity: 'IMMINENT',
        attentionScore: 100,
      }),
    ).toBe(60_000);
  });

  it('journals and dispatches typed in-process events', async () => {
    const append = vi.fn(async () => undefined);
    const handler = vi.fn(async () => undefined);
    const events = new InProcessEventBus({ append });
    events.subscribe('company.added', handler);

    const event = await events.publish({
      type: 'company.added',
      aggregateType: 'COMPANY',
      aggregateId: 'company-1',
      payload: { ticker: 'MU' },
    });

    expect(append).toHaveBeenCalledWith(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('enforces automated lifecycle transitions but permits operator overrides', () => {
    expect(() =>
      assertCompanyTransition('DISCOVERY', 'CORE', 'AUTOMATED'),
    ).toThrow('Invalid automated tier transition');
    expect(() =>
      assertCompanyTransition('DISCOVERY', 'CORE', 'MANUAL'),
    ).not.toThrow();
  });

  it('updates universe state and emits the change', async () => {
    const updateCompanyState = vi.fn(async () => ({
      ...company,
      monitoringTier: 'INVESTIGATE' as const,
      monitoringMode: 'HIGH_RESOLUTION' as const,
    }));
    const repository = {
      createCompany: vi.fn(async () => company),
      findCompany: vi.fn(async () => company),
      updateCompanyState,
    };
    const events = new InProcessEventBus();
    const publish = vi.spyOn(events, 'publish');
    const manager = new CompanyUniverseManager(repository, events);

    const updated = await manager.updateState(
      company.chatConfigId,
      company.ticker,
      {
        monitoringTier: 'INVESTIGATE',
        monitoringMode: 'HIGH_RESOLUTION',
      },
      'AUTOMATED',
    );

    expect(updated.monitoringTier).toBe('INVESTIGATE');
    expect(updateCompanyState).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'company.state_changed' }),
    );
  });

  it('classifies routine Form 4 disclosures as low materiality', () => {
    const event = extractCanonicalEvent(
      normalizeObservation('STOCKS', {
        id: 'SEC:form4',
        source: 'SEC',
        externalId: 'form4',
        title: 'Micron Form 4 ownership filing',
        url: 'https://www.sec.gov/Archives/edgar/data/723125/000110465926101067/primary.xml',
        content: 'Routine sale of securities by a reporting person.',
        sourceType: 'REGULATORY',
        primarySource: true,
        category: 'INSIDER_TRANSACTION',
        normalizedFacts: { form: '4' },
        metadata: { symbol: 'MU' },
      }),
    );

    expect(event).toMatchObject({
      eventType: 'INSIDER_TRANSACTION',
      materiality: 'LOW',
      action: 'STATE_UPDATE',
    });
  });

  it('escalates strategic events and compares similar reports', () => {
    const event = extractCanonicalEvent(
      normalizeObservation('STOCKS', {
        id: 'IR:deal',
        source: 'INVESTOR_RELATIONS',
        externalId: 'deal',
        title: 'Micron announces major acquisition',
        url: 'https://investors.example.com/deal',
        content: 'The company entered a definitive merger agreement.',
        sourceType: 'INVESTOR_RELATIONS',
        primarySource: true,
        category: 'COMPANY_EVENT',
        metadata: { symbol: 'MU' },
      }),
    );

    expect(event).toMatchObject({
      eventType: 'ACQUISITION',
      materiality: 'HIGH',
      action: 'FULL_ANALYSIS',
    });
    expect(
      titleSimilarity(
        'Micron announces major acquisition of Sample Corp',
        'Sample Corp acquired by Micron in major transaction',
      ),
    ).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps raw market snapshots out of canonical events', () => {
    expect(
      extractCanonicalEvent(
        normalizeObservation('STOCKS', {
          id: 'PRICE:mu',
          source: 'PRICE',
          externalId: 'mu',
          title: 'MU price snapshot',
          url: 'https://stooq.com/q/?s=mu.us',
          content: 'Open 100; close 101.',
          sourceType: 'MARKET_DATA',
          category: 'PRICE_SNAPSHOT',
          metadata: { symbol: 'MU' },
        }),
      ),
    ).toBeNull();
  });

  it('normalizes contract materiality to company scale', () => {
    const observation = normalizeObservation('STOCKS', {
      id: 'NEWS:contract',
      source: 'NEWS',
      externalId: 'contract',
      title: 'Company wins federal government contract',
      url: 'https://example.com/contract',
      content: 'An official award was announced.',
      sourceType: 'NEWS',
      category: 'COMPANY_EVENT',
      normalizedFacts: { contractValueUsd: 50_000_000 },
      metadata: { symbol: 'TEST' },
    });

    expect(
      extractCanonicalEvent(observation, { marketCapUsd: 300_000_000 }),
    ).toMatchObject({
      eventType: 'GOVERNMENT_CONTRACT',
      materiality: 'EXTREME',
    });
    expect(
      extractCanonicalEvent(observation, { marketCapUsd: 500_000_000_000 }),
    ).toMatchObject({
      eventType: 'GOVERNMENT_CONTRACT',
      materiality: 'LOW',
    });
  });

  it('filters market-wide discovery candidates before investigation', () => {
    const observedAt = new Date('2026-09-04T14:30:00Z');
    const candidates = selectDiscoveryCandidates(
      [
        {
          ticker: 'GOOD',
          price: 10,
          changePercent: 6,
          volume: 500_000,
          observedAt,
          source: 'MARKET',
          trigger: 'PRICE_MOVE',
        },
        {
          ticker: 'PENNY',
          price: 0.5,
          changePercent: 50,
          volume: 10_000_000,
          observedAt,
          source: 'MARKET',
          trigger: 'PRICE_MOVE',
        },
        {
          ticker: 'QUIET',
          price: 30,
          changePercent: 1,
          volume: 1_000_000,
          observedAt,
          source: 'MARKET',
          trigger: 'MOST_ACTIVE',
        },
      ],
      {
        moveThresholdPercent: 4,
        minimumPrice: 2,
        minimumVolume: 100_000,
        minimumDollarVolume: 1_000_000,
        maximumCandidates: 10,
        supportedTicker: /^[A-Z]+$/,
        supportedExchanges: ['NASDAQ'],
        excludeOtc: true,
      },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      ticker: 'GOOD',
      attentionScore: 78,
      dollarVolume: 5_000_000,
    });
  });

  it('rejects unsupported and OTC discovery listings', () => {
    const policy = {
      moveThresholdPercent: 4,
      minimumPrice: 2,
      minimumVolume: 100_000,
      minimumDollarVolume: 1_000_000,
      maximumCandidates: 10,
      supportedTicker: /^[A-Z]+$/,
      supportedExchanges: ['NASDAQ', 'NYSE'],
      excludeOtc: true,
    };

    expect(discoveryCompanyIsEligible('Nasdaq', policy)).toBe(true);
    expect(discoveryCompanyIsEligible('OTC', policy)).toBe(false);
    expect(discoveryCompanyIsEligible('Cboe', policy)).toBe(false);
  });

  it('expires unresolved investigations and normalizes temporary watch mode', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    expect(
      investigationExpiryDecision({
        tier: 'INVESTIGATE',
        mode: 'HIGH_RESOLUTION',
        investigateUntil: new Date('2026-09-04T11:59:00Z'),
        highResolutionUntil: new Date('2026-09-04T11:59:00Z'),
        now,
      }),
    ).toMatchObject({ action: 'RETURN_TO_DISCOVERY' });
    expect(
      investigationExpiryDecision({
        tier: 'WATCH',
        mode: 'EVENT_MODE',
        investigateUntil: null,
        highResolutionUntil: new Date('2026-09-04T11:59:00Z'),
        now,
      }),
    ).toMatchObject({ action: 'NORMALIZE_WATCH_MODE' });
  });
});
