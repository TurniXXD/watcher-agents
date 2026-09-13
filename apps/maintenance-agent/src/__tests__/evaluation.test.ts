import { describe, expect, it } from 'vitest';
import {
  detectAll,
  detectBriefingUsageMismatch,
  detectDuplicateOutput,
  detectLowValueOutput,
  detectNoisyOutput,
  detectPoorClassification,
  detectRecurringFailures,
  detectStaleSources,
  prioritizeForBriefing,
  severityForFailureRate,
} from '../evaluation/detectors.js';
import { calculateSourceHealth } from '../evaluation/source-health.js';
import { configDiff, rollingBaseline } from '../evaluation/statistics.js';
import type { Finding, RunObservation } from '../evaluation/types.js';

const now = new Date('2026-09-09T12:00:00Z');
const run = (
  index: number,
  input: Partial<RunObservation> = {},
): RunObservation => ({
  id: `run-${index}`,
  agentName: 'fixture-agent',
  startedAt: new Date(now.getTime() - (10 - index) * 3_600_000),
  status: 'SUCCESS',
  sources: [],
  feedback: [],
  ...input,
});

describe('maintenance evaluation', () => {
  it('detects seven failures in ten runs as recurring and high severity', () => {
    const runs = Array.from({ length: 10 }, (_, index) =>
      run(index, { status: index < 3 ? 'SUCCESS' : 'FAILED' }),
    );
    const finding = detectRecurringFailures(runs, now).find(
      (item) => item.type === 'RECURRING_FAILURE',
    );
    expect(finding?.severity).toBe('HIGH');
    expect(finding?.evidence['failureCount']).toBe(7);
  });

  it('detects a stale source relative to its historical cadence', () => {
    const daysAgo = [24, 22, 20, 15, 10, 5, 0];
    const runs = daysAgo.map((days, index) =>
      run(index, {
        sources: [
          {
            sourceId: 'rss',
            status: 'success',
            itemCount: days >= 20 ? 1 : 0,
            createdAt: new Date(now.getTime() - days * 86_400_000),
          },
        ],
      }),
    );
    expect(detectStaleSources(runs, now)[0]?.type).toBe('STALE_SOURCE');
  });

  it('detects 82 percent downstream filtering as noisy output', () => {
    const runs = [
      run(1, {
        feedback: Array.from({ length: 100 }, (_, index) => ({
          action: index < 82 ? 'FILTERED' : 'OPENED',
        })),
      }),
    ];
    expect(detectNoisyOutput(runs, now)[0]?.type).toBe('NOISY_OUTPUT');
  });

  it('does not treat normal upstream filtering as negative feedback', () => {
    const runs = Array.from({ length: 10 }, (_, index) =>
      run(index, { itemsProduced: 18, itemsFiltered: 82 }),
    );
    expect(detectNoisyOutput(runs, now)).toEqual([]);
  });

  it('detects direct low-value consumer feedback', () => {
    const feedback = Array.from({ length: 10 }, (_, index) => ({
      action: index < 8 ? 'MARKED_NOT_USEFUL' : 'MARKED_USEFUL',
      reason: index < 8 ? 'not actionable' : 'useful',
    }));
    expect(detectLowValueOutput([run(1, { feedback })], now)[0]).toMatchObject({
      type: 'LOW_VALUE_OUTPUT',
      severity: 'HIGH',
      agentName: 'fixture-agent',
    });
  });

  it('detects a mismatch between producer output and briefing usage', () => {
    const briefingRun = run(1, {
      agentName: 'briefing-bot',
      metadata: {
        noise: {
          stocks: { eventsEmitted: 100, eventsSelected: 4 },
        },
      },
    });
    expect(detectBriefingUsageMismatch([briefingRun], now)[0]).toMatchObject({
      type: 'LOW_VALUE_OUTPUT',
      agentName: 'stocks-bot',
      evidence: { emittedCount: 100, selectedCount: 4 },
    });
  });

  it('detects an output-volume regression without feedback data', () => {
    const runs = [2, 3, 2, 30, 32, 31].map((itemsProduced, index) =>
      run(index, { itemsProduced }),
    );
    expect(
      detectNoisyOutput(runs, now).some(
        (finding) => finding.evidence['observedValue'] === 31,
      ),
    ).toBe(true);
  });

  it('detects a high duplicate rate', () => {
    const runs = [run(1, { itemsFetched: 100, duplicatesRemoved: 41 })];
    expect(detectDuplicateOutput(runs, now)[0]?.type).toBe('DUPLICATE_OUTPUT');
  });

  it('detects feedback-backed poor classification', () => {
    const feedback = Array.from({ length: 10 }, (_, index) => ({
      action: 'FILTERED',
      reason: index < 7 ? 'wrong classification: deadline' : 'not relevant',
    }));
    expect(detectPoorClassification([run(1, { feedback })], now)[0]?.type).toBe(
      'POOR_CLASSIFICATION',
    );
  });

  it('calculates source health and consecutive failures', () => {
    const runs = [
      run(1, {
        sources: [
          {
            sourceId: 'api',
            status: 'success',
            itemCount: 3,
            latencyMs: 100,
            createdAt: new Date('2026-09-07'),
          },
        ],
      }),
      run(2, {
        sources: [
          {
            sourceId: 'api',
            status: 'failed',
            itemCount: 0,
            latencyMs: 200,
            createdAt: new Date('2026-09-08'),
          },
        ],
      }),
      run(3, {
        sources: [
          {
            sourceId: 'api',
            status: 'failed',
            itemCount: 0,
            latencyMs: 300,
            createdAt: new Date('2026-09-09'),
          },
        ],
      }),
    ];
    const health = calculateSourceHealth(runs, now)[0];
    expect(health).toMatchObject({
      totalRuns: 3,
      successfulRuns: 1,
      failedRuns: 2,
      consecutiveFailures: 2,
      itemsProduced: 3,
    });
    expect(health?.averageLatencyMs).toBe(200);
  });

  it('uses robust rolling baselines', () => {
    expect(rollingBaseline([1, 2, 2, 3, 100])).toMatchObject({
      median: 2,
      mad: 1,
      p50: 2,
      p95: 100,
    });
  });

  it('assigns severity deterministically', () => {
    expect(severityForFailureRate(0.7, 2)).toBe('HIGH');
    expect(severityForFailureRate(0.1, 3)).toBe('MEDIUM');
  });

  it('deduplicates recommendations through stable finding fingerprints', () => {
    const runs = Array.from({ length: 4 }, (_, index) =>
      run(index, { status: 'FAILED' }),
    );
    const findings = detectAll(runs, now);
    expect(new Set(findings.map((item) => item.fingerprint)).size).toBe(
      findings.length,
    );
    expect(detectAll(runs, now)[0]?.fingerprint).toBe(findings[0]?.fingerprint);
  });

  it('emits one recommendation for an actively failing source', () => {
    const runs = Array.from({ length: 5 }, (_, index) =>
      run(index, {
        sources: [
          {
            sourceId: 'FDA',
            status: 'failed',
            itemCount: 0,
            createdAt: new Date(now.getTime() - (5 - index) * 3_600_000),
          },
        ],
      }),
    );
    const sourceFindings = detectAll(runs, now).filter(
      (finding) => finding.evidence['sourceId'] === 'FDA',
    );
    expect(sourceFindings).toHaveLength(1);
    expect(sourceFindings[0]?.type).toBe('RECURRING_FAILURE');
  });

  it('does not propose source repair after the latest request succeeds', () => {
    const runs = Array.from({ length: 5 }, (_, index) =>
      run(index, {
        sources: [
          {
            sourceId: 'FDA',
            status: index === 4 ? 'success' : 'failed',
            itemCount: 0,
            createdAt: new Date(now.getTime() - (5 - index) * 3_600_000),
          },
        ],
      }),
    );
    expect(
      detectAll(runs, now).filter(
        (finding) => finding.evidence['sourceId'] === 'FDA',
      ),
    ).toEqual([]);
  });

  it('generates an exact config diff', () => {
    expect(configDiff(2, 3)).toEqual({ from: 2, to: 3 });
  });

  it('prioritizes important briefing findings', () => {
    const finding = (
      severity: Finding['severity'],
      confidence: number,
    ): Finding => ({
      fingerprint: `${severity}-${confidence}`,
      agentName: 'agent',
      type: 'OTHER',
      severity,
      title: severity,
      description: severity,
      evidence: {},
      confidence,
      detectedAt: now,
      recommendation: { type: 'OTHER', title: 'review', rationale: 'evidence' },
    });
    const result = prioritizeForBriefing([
      finding('LOW', 1),
      finding('MEDIUM', 0.8),
      finding('CRITICAL', 0.5),
      finding('HIGH', 0.9),
    ]);
    expect(result.map((item) => item.severity)).toEqual([
      'CRITICAL',
      'HIGH',
      'MEDIUM',
    ]);
  });
});
