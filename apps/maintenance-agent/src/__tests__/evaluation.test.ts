import { describe, expect, it } from 'vitest';
import {
  detectAll,
  detectDuplicateOutput,
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
    const runs = Array.from({ length: 10 }, (_, index) =>
      run(index, { itemsProduced: 18, itemsFiltered: 82 }),
    );
    expect(detectNoisyOutput(runs, now)[0]?.type).toBe('NOISY_OUTPUT');
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
    expect(
      detectPoorClassification([run(1, { feedback })], now)[0]?.type,
    ).toBe('POOR_CLASSIFICATION');
  });

  it('calculates source health and consecutive failures', () => {
    const runs = [
      run(1, { sources: [{ sourceId: 'api', status: 'success', itemCount: 3, latencyMs: 100, createdAt: new Date('2026-09-07') }] }),
      run(2, { sources: [{ sourceId: 'api', status: 'failed', itemCount: 0, latencyMs: 200, createdAt: new Date('2026-09-08') }] }),
      run(3, { sources: [{ sourceId: 'api', status: 'failed', itemCount: 0, latencyMs: 300, createdAt: new Date('2026-09-09') }] }),
    ];
    const health = calculateSourceHealth(runs, now)[0];
    expect(health).toMatchObject({ totalRuns: 3, successfulRuns: 1, failedRuns: 2, consecutiveFailures: 2, itemsProduced: 3 });
    expect(health?.averageLatencyMs).toBe(200);
  });

  it('uses robust rolling baselines', () => {
    expect(rollingBaseline([1, 2, 2, 3, 100])).toMatchObject({ median: 2, mad: 1, p50: 2, p95: 100 });
  });

  it('assigns severity deterministically', () => {
    expect(severityForFailureRate(0.7, 2)).toBe('HIGH');
    expect(severityForFailureRate(0.1, 3)).toBe('MEDIUM');
  });

  it('deduplicates recommendations through stable finding fingerprints', () => {
    const runs = Array.from({ length: 4 }, (_, index) => run(index, { status: 'FAILED' }));
    const findings = detectAll(runs, now);
    expect(new Set(findings.map((item) => item.fingerprint)).size).toBe(findings.length);
    expect(detectAll(runs, now)[0]?.fingerprint).toBe(findings[0]?.fingerprint);
  });

  it('generates an exact config diff', () => {
    expect(configDiff(2, 3)).toEqual({ from: 2, to: 3 });
  });

  it('prioritizes important briefing findings', () => {
    const finding = (severity: Finding['severity'], confidence: number): Finding => ({
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
    expect(result.map((item) => item.severity)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM']);
  });
});
