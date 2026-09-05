import {
  stockIntelligenceResultSchema,
  type StockIntelligenceResult,
} from '@watcher/core';
import { describe, expect, it } from 'vitest';
import { evaluateStockAlert } from '../alerting.js';

const intelligence = (
  overrides: {
    attentionScore?: number;
    thesisChange?: 'UNCHANGED' | 'IMPROVED';
  } = {},
): StockIntelligenceResult =>
  stockIntelligenceResultSchema.parse({
    eventId: 'event-1',
    targeted: {
      materiality: 'MEDIUM',
      thesisChange: overrides.thesisChange ?? 'UNCHANGED',
      informationChange: 'NEW_INFORMATION',
      reanalysisRequired: false,
      affectedSignalGroups: [],
      catalystChange: 'UNCHANGED',
      recommendationChange: false,
      primaryDriver: 'Observed market event',
      explanation: 'Evidence was evaluated without unsupported inference.',
      risks: [],
      confidence: 0.7,
    },
    fullAnalysisPerformed: false,
    redundancyClass: 'INDEPENDENT',
    redundancyMultiplier: 1,
    reliabilityWeight: 1,
    state: {
      ticker: 'MU',
      thesis: 'Continue monitoring verified evidence.',
      verdict: 'WATCH',
      confidence: 0.7,
      attentionScore: overrides.attentionScore ?? 50,
      bullScore: 1,
      bearScore: 1,
      netSignal: 0,
      signalGroups: [],
      catalysts: [],
      insiderConviction: null,
      pricedIn: 'UNKNOWN',
      primaryDrivers: [],
      risks: [],
      dataCoverage: 60,
      dataQuality: 'MEDIUM',
      materialDataGaps: [],
      decision: null,
    },
    decision: null,
  });

describe('stock alert policy', () => {
  it('alerts on unexplained activity without claiming an information leak', () => {
    const alert = evaluateStockAlert(
      {
        eventType: 'PRICE_ANOMALY',
        materiality: 'MEDIUM',
        title: 'Unusual price and volume activity',
        magnitude: { unexplained: true },
        hasExtremeCatalyst: false,
      },
      intelligence(),
      null,
      85,
    );

    expect(alert).toMatchObject({
      type: 'UNEXPLAINED_ACTIVITY',
      severity: 'HIGH',
    });
    expect(alert?.reasons.join(' ')).toContain(
      'no information leak is inferred',
    );
  });

  it('alerts when attention crosses the configured threshold', () => {
    const alert = evaluateStockAlert(
      {
        eventType: 'OTHER',
        materiality: 'MEDIUM',
        title: 'New evidence',
        magnitude: {},
        hasExtremeCatalyst: false,
      },
      intelligence({ attentionScore: 86 }),
      { verdict: 'WATCH', attentionScore: 80, decision: null },
      85,
    );

    expect(alert?.reasons).toContain('Attention crossed 85 and reached 86.');
    expect(alert).toMatchObject({
      type: 'HIGH_PRIORITY',
      severity: 'HIGH',
    });
  });

  it('stays silent for a non-material unchanged event', () => {
    expect(
      evaluateStockAlert(
        {
          eventType: 'OTHER',
          materiality: 'MEDIUM',
          title: 'Repeated context',
          magnitude: {},
          hasExtremeCatalyst: false,
        },
        intelligence(),
        { verdict: 'WATCH', attentionScore: 50, decision: null },
        85,
      ),
    ).toBeNull();
  });
});
