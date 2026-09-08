import { describe, expect, it } from 'vitest';
import type { NormalizedObservation } from '@watcher/core';
import {
  eventNeedsAnalysis,
  semanticClusterSupported,
} from '../../stock-event-store.js';
import { extractCanonicalEvent } from '../intelligence.js';
import { evaluateMateriality } from '../materiality.js';
import { stockAlertDeliverAfter } from '../notification.js';

const observation = (
  title: string,
  rawText = title,
): NormalizedObservation => ({
  id: title,
  watcherKind: 'STOCKS',
  ticker: 'AOUT',
  source: 'NEWS',
  sourceType: 'NEWS',
  sourceUrl: 'https://example.com/event',
  primarySource: false,
  publishedAt: new Date('2026-09-08T12:00:00Z'),
  discoveredAt: new Date('2026-09-08T12:01:00Z'),
  eventAt: new Date('2026-09-08T12:00:00Z'),
  category: 'OTHER',
  headline: title,
  rawText,
  normalizedFacts: {},
  entities: ['American Outdoor Brands'],
  reliability: 0.75,
  metadata: { symbol: 'AOUT' },
});

describe('hybrid stock event policy', () => {
  it('always analyzes HIGH even if a legacy action says STORE', () => {
    expect(eventNeedsAnalysis('HIGH', 'STORE')).toBe(true);
    expect(eventNeedsAnalysis('EXTREME', 'STATE_UPDATE')).toBe(true);
  });

  it('upgrades LOW/OTHER on an abnormal +8% move', () => {
    expect(
      evaluateMateriality({
        initialMateriality: 'LOW',
        initialScore: 20,
        eventTypes: ['OTHER'],
        market: { dailyReturnPercent: 8, relativeVolume: 1.2 },
      }),
    ).toMatchObject({ shouldAnalyze: true, materiality: 'HIGH' });
  });

  it('skips a generic LOW article with normal market behavior', () => {
    expect(
      evaluateMateriality({
        initialMateriality: 'LOW',
        initialScore: 20,
        eventTypes: ['OTHER'],
        market: { dailyReturnPercent: 0.5, relativeVolume: 0.9 },
      }),
    ).toMatchObject({ shouldAnalyze: false, action: 'STATE_UPDATE' });
  });

  it('handles missing market history without throwing', () => {
    expect(
      evaluateMateriality({
        initialMateriality: 'LOW',
        initialScore: 20,
        eventTypes: ['OTHER'],
      }).shouldAnalyze,
    ).toBe(false);
  });

  it('keeps multiple event types for an AOUT-style catalyst', () => {
    const event = extractCanonicalEvent(
      observation(
        'AOUT Q1 revenue, margins and guidance beat as Roth raises target; shares jump 40%',
        'Q1 revenue and EBITDA improved. Guidance increased and Roth raised its price target while shares jumped 40%.',
      ),
    );
    expect(event?.eventTypes).toEqual(
      expect.arrayContaining([
        'EARNINGS',
        'GUIDANCE',
        'ANALYST_REVISION',
        'PRICE_MOVE',
      ]),
    );
    expect(event?.materiality).toBe('HIGH');
  });

  it('retains legacy and broad financing/capital-return classifications', () => {
    const event = extractCanonicalEvent(
      observation('AOUT announces convertible notes and a new share buyback'),
    );
    expect(event?.eventTypes).toEqual(
      expect.arrayContaining([
        'CAPITAL_RAISE',
        'FINANCING',
        'BUYBACK',
        'CAPITAL_RETURN',
      ]),
    );
  });

  it('does not merge unrelated stories on semantic similarity alone', () => {
    expect(
      semanticClusterSupported(
        { eventTypes: ['ACQUISITION'], title: 'NVDA buys Hugging Face' },
        {
          eventTypes: ['MACRO_EVENT'],
          title: 'Bond yields pressure technology stocks including NVDA',
        },
      ),
    ).toBe(false);
  });

  it('does not merge separate acquisitions with different targets', () => {
    expect(
      semanticClusterSupported(
        {
          ticker: 'NVDA',
          eventTypes: ['ACQUISITION'],
          title: 'NVDA buys Hugging Face',
        },
        {
          ticker: 'NVDA',
          eventTypes: ['ACQUISITION'],
          title: 'NVDA buys Runware Labs',
        },
      ),
    ).toBe(false);
  });

  it('accepts supporting earnings and guidance evidence', () => {
    expect(
      semanticClusterSupported(
        { eventTypes: ['EARNINGS'], title: 'AOUT reports quarterly results' },
        {
          eventTypes: ['GUIDANCE', 'ANALYST_REVISION'],
          title: 'AOUT guidance rises after quarterly results',
        },
      ),
    ).toBe(true);
  });

  it('queues HIGH overnight until the morning but allows EXTREME now', () => {
    const overnight = new Date('2026-09-08T23:40:00+02:00');
    const queued = stockAlertDeliverAfter(overnight, 'HIGH', 'Europe/Prague');
    expect(queued.getTime()).toBeGreaterThan(overnight.getTime());
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Prague',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(queued),
    ).toBe('07');
    expect(
      stockAlertDeliverAfter(overnight, 'EXTREME', 'Europe/Prague'),
    ).toEqual(overnight);
  });
});
