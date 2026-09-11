import { createHash } from 'node:crypto';
import { calculateSourceHealth } from './source-health.js';
import {
  configDiff,
  median,
  percentile,
  rollingBaseline,
} from './statistics.js';
import type { Finding, RunObservation, Severity } from './types.js';

const fingerprint = (agent: string, type: string, scope = 'agent'): string =>
  createHash('sha256').update(`${agent}:${type}:${scope}`).digest('hex');

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const runErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === 'string') return error;
  const record = recordValue(error);
  return typeof record?.['message'] === 'string'
    ? record['message']
    : undefined;
};

const producerAgentNames: Record<string, string> = {
  stocks: 'stocks-bot',
  medical: 'publications-bot',
  news: 'news-bot',
  'mu-clubs': 'mu-clubs-monitor',
};

export const severityForFailureRate = (
  failureRate: number,
  consecutiveFailures: number,
): Severity => {
  if (failureRate >= 0.9 && consecutiveFailures >= 5) return 'CRITICAL';
  if (failureRate > 0.5 || consecutiveFailures >= 5) return 'HIGH';
  if (failureRate >= 0.25 || consecutiveFailures >= 3) return 'MEDIUM';
  return 'LOW';
};

const base = (
  agentName: string,
  type: Finding['type'],
  scope: string,
  now: Date,
) => ({
  fingerprint: fingerprint(agentName, type, scope),
  agentName,
  type,
  detectedAt: now,
});

export const detectRecurringFailures = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  const agents = new Set(runs.map((run) => run.agentName));
  for (const agentName of agents) {
    const recent = runs.filter((run) => run.agentName === agentName).slice(-20);
    if (recent.length < 3) continue;
    const failures = recent.filter((run) => run.status === 'FAILED');
    let consecutive = 0;
    for (const run of [...recent].reverse()) {
      if (run.status !== 'FAILED') break;
      consecutive++;
    }
    const rate = failures.length / recent.length;
    if (consecutive < 3 && rate < 0.25) continue;
    findings.push({
      ...base(agentName, 'RECURRING_FAILURE', 'runs', now),
      severity: severityForFailureRate(rate, consecutive),
      title: `${agentName} has recurring run failures`,
      description: `${failures.length} of the last ${recent.length} runs failed.`,
      evidence: {
        periodStart: recent[0]?.startedAt.toISOString(),
        periodEnd: recent.at(-1)?.startedAt.toISOString(),
        runCount: recent.length,
        failureCount: failures.length,
        consecutiveFailures: consecutive,
        observedValue: rate,
        expectedValue: '< 0.25',
        examples: failures.slice(-3).map((run) => ({
          runId: run.id,
          description: runErrorMessage(run.error) ?? 'Run failed',
        })),
      },
      confidence: Math.min(0.99, 0.65 + recent.length / 100),
      recommendation: {
        type: 'CODE_CHANGE',
        title:
          'Investigate the repeated run failure before changing thresholds',
        rationale:
          'The failure rate crosses the deterministic operational threshold.',
        expectedImpact: 'Restore reliable data production.',
        risk: 'Low; this is a proposal only and does not alter production.',
      },
    });
  }
  for (const health of calculateSourceHealth(runs, now)) {
    const rate = 1 - health.successRate;
    if (health.totalRuns < 3 || (health.consecutiveFailures < 3 && rate < 0.25))
      continue;
    const examples = runs
      .filter((run) => run.agentName === health.agentName)
      .flatMap((run) =>
        run.sources
          .filter(
            (source) =>
              source.sourceId === health.sourceId &&
              source.status.toLowerCase() !== 'success',
          )
          .map((source) => ({
            runId: run.id,
            sourceId: source.sourceId,
            description: source.error ?? 'Source request failed',
          })),
      )
      .slice(-3);
    findings.push({
      ...base(health.agentName, 'RECURRING_FAILURE', health.sourceId, now),
      severity: severityForFailureRate(rate, health.consecutiveFailures),
      title: `${health.sourceId} is failing repeatedly`,
      description: `${health.failedRuns} of ${health.totalRuns} source requests failed.`,
      evidence: {
        sourceId: health.sourceId,
        runCount: health.totalRuns,
        failureCount: health.failedRuns,
        consecutiveFailures: health.consecutiveFailures,
        observedValue: rate,
        expectedValue: '< 0.25',
        examples,
      },
      confidence: Math.min(0.98, 0.65 + health.totalRuns / 100),
      recommendation: {
        type: 'SOURCE_CHANGE',
        title: `Repair or reduce reliance on ${health.sourceId}`,
        rationale: 'Repeated source failures are reducing coverage.',
        expectedImpact: 'Improve run coverage and reduce error noise.',
      },
    });
  }
  return findings;
};

export const detectNoisyOutput = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  for (const agentName of new Set(runs.map((run) => run.agentName))) {
    const selected = runs.filter((run) => run.agentName === agentName);
    const feedback = selected.flatMap((run) => run.feedback);
    const filteredFeedback = feedback.filter((item) =>
      ['FILTERED', 'IGNORED', 'DISMISSED', 'MARKED_NOT_USEFUL'].includes(
        item.action,
      ),
    ).length;
    const produced = selected.reduce(
      (sum, run) => sum + (run.itemsProduced ?? 0),
      0,
    );
    const filtered = Math.max(
      filteredFeedback,
      selected.reduce((sum, run) => sum + (run.itemsFiltered ?? 0), 0),
    );
    const denominator = Math.max(feedback.length, produced + filtered);
    const rate = denominator === 0 ? 0 : filtered / denominator;
    if (denominator >= 10 && rate > 0.7) {
      findings.push({
        ...base(agentName, 'NOISY_OUTPUT', 'downstream-filtering', now),
        severity: rate >= 0.9 ? 'HIGH' : 'MEDIUM',
        title: `${agentName} outputs are frequently filtered`,
        description: `${Math.round(rate * 100)}% of observed outputs were filtered or ignored.`,
        evidence: {
          runCount: selected.length,
          observedValue: rate,
          expectedValue: '<= 0.7',
        },
        confidence: Math.min(0.98, 0.7 + denominator / 500),
        recommendation: {
          type: 'THRESHOLD_CHANGE',
          title: 'Tighten upstream relevance filtering',
          rationale: 'Downstream consumers discard most produced items.',
          proposal: {
            configDiff: {
              minimumRelevance: configDiff('current', 'increase by 1'),
            },
          },
        },
      });
    }

    const volumes = selected.flatMap((run) =>
      run.itemsProduced == null ? [] : [run.itemsProduced],
    );
    const middle = Math.floor(volumes.length / 2);
    const prior = median(volumes.slice(0, middle));
    const current = median(volumes.slice(middle));
    if (
      volumes.length >= 6 &&
      prior !== undefined &&
      current !== undefined &&
      current > prior * 2 &&
      current - prior >= 10
    ) {
      findings.push({
        ...base(agentName, 'NOISY_OUTPUT', 'volume-regression', now),
        severity: current > prior * 4 ? 'HIGH' : 'MEDIUM',
        title: `${agentName} output volume increased sharply`,
        description: `Recent median output volume is ${current} items per run versus ${prior}.`,
        evidence: {
          runCount: volumes.length,
          observedValue: current,
          expectedValue: prior,
          baseline: rollingBaseline(volumes),
        },
        confidence: 0.84,
        recommendation: {
          type: 'THRESHOLD_CHANGE',
          title: 'Review upstream filtering after the output-volume change',
          rationale:
            'Output volume more than doubled relative to the agent’s own baseline.',
        },
      });
    }
  }
  return findings;
};

export const detectLowValueOutput = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  for (const agentName of new Set(runs.map((run) => run.agentName))) {
    const feedback = runs
      .filter((run) => run.agentName === agentName)
      .flatMap((run) => run.feedback);
    const negative = feedback.filter((item) =>
      ['IGNORED', 'DISMISSED', 'MARKED_NOT_USEFUL'].includes(item.action),
    );
    const rate = feedback.length === 0 ? 0 : negative.length / feedback.length;
    if (feedback.length < 10 || rate < 0.6) continue;
    findings.push({
      ...base(agentName, 'LOW_VALUE_OUTPUT', 'consumer-feedback', now),
      severity: rate >= 0.8 ? 'HIGH' : 'MEDIUM',
      title: `${agentName} outputs receive low-value feedback`,
      description: `${negative.length} of ${feedback.length} feedback records were ignored, dismissed, or marked not useful.`,
      evidence: {
        observedValue: rate,
        expectedValue: '< 0.6',
        examples: negative.slice(0, 3).map((item) => ({
          description: item.reason ?? item.action,
        })),
      },
      confidence: Math.min(0.98, 0.7 + feedback.length / 500),
      recommendation: {
        type: 'THRESHOLD_CHANGE',
        title: 'Raise the minimum usefulness threshold',
        rationale:
          'Direct consumer feedback indicates that most observed outputs have low value.',
        proposal: {
          configDiff: {
            minimumImportance: configDiff('current', 'increase by 1'),
          },
        },
      },
    });
  }
  return findings;
};

export const detectBriefingUsageMismatch = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const usage = new Map<string, { emitted: number; selected: number }>();
  for (const run of runs.filter((item) => item.agentName === 'briefing-bot')) {
    const noise = recordValue(recordValue(run.metadata)?.['noise']);
    if (!noise) continue;
    for (const [watcherBot, rawMetrics] of Object.entries(noise)) {
      const agentName = producerAgentNames[watcherBot];
      const metrics = recordValue(rawMetrics);
      const emitted = finiteNumber(metrics?.['eventsEmitted']);
      const selected = finiteNumber(metrics?.['eventsSelected']);
      if (!agentName || emitted === undefined || selected === undefined)
        continue;
      const aggregate = usage.get(agentName) ?? { emitted: 0, selected: 0 };
      aggregate.emitted += emitted;
      aggregate.selected += selected;
      usage.set(agentName, aggregate);
    }
  }
  return [...usage.entries()].flatMap(([agentName, metrics]): Finding[] => {
    const selectionRate =
      metrics.emitted === 0 ? 1 : metrics.selected / metrics.emitted;
    if (metrics.emitted < 20 || selectionRate >= 0.1) return [];
    return [
      {
        ...base(agentName, 'LOW_VALUE_OUTPUT', 'briefing-usage', now),
        severity: selectionRate < 0.03 ? 'HIGH' : 'MEDIUM',
        title: `${agentName} rarely contributes to briefings`,
        description: `Briefing selected ${metrics.selected} of ${metrics.emitted} emitted events.`,
        evidence: {
          metric: 'briefing selection rate',
          observedValue: selectionRate,
          expectedValue: '>= 0.1',
          emittedCount: metrics.emitted,
          selectedCount: metrics.selected,
        },
        confidence: Math.min(0.98, 0.75 + metrics.emitted / 1000),
        recommendation: {
          type: 'THRESHOLD_CHANGE',
          title: 'Align producer ranking with briefing selection criteria',
          rationale:
            'The downstream briefing repeatedly rejects more than 90% of this producer’s events.',
          proposal: {
            configDiff: {
              minimumBriefingRelevance: configDiff(
                'current',
                'increase after reviewing rejected examples',
              ),
            },
          },
        },
      },
    ];
  });
};

export const detectDuplicateOutput = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  for (const agentName of new Set(runs.map((run) => run.agentName))) {
    const selected = runs.filter((run) => run.agentName === agentName);
    const duplicates = selected.reduce(
      (sum, run) => sum + (run.duplicatesRemoved ?? 0),
      0,
    );
    const found = selected.reduce(
      (sum, run) => sum + (run.itemsFetched ?? 0),
      0,
    );
    const rate = found === 0 ? 0 : duplicates / found;
    if (found < 10 || rate < 0.25) continue;
    findings.push({
      ...base(agentName, 'DUPLICATE_OUTPUT', 'items', now),
      severity: rate >= 0.6 ? 'HIGH' : 'MEDIUM',
      title: `${agentName} has a high duplicate rate`,
      description: `${duplicates} of ${found} fetched items were duplicates.`,
      evidence: {
        runCount: selected.length,
        observedValue: rate,
        expectedValue: '< 0.25',
      },
      confidence: 0.9,
      recommendation: {
        type: 'CONFIG_CHANGE',
        title: 'Increase and unify the deduplication window',
        rationale:
          'Stable IDs and cross-source fingerprints should prevent repeated work.',
        proposal: {
          configDiff: {
            deduplicationWindow: configDiff('current', 'increase after review'),
          },
        },
      },
    });
  }
  return findings;
};

export const detectPoorClassification = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  for (const agentName of new Set(runs.map((run) => run.agentName))) {
    const feedback = runs
      .filter((run) => run.agentName === agentName)
      .flatMap((run) => run.feedback);
    const corrections = feedback.filter((item) =>
      /classif|reclass|wrong category|incorrect label/i.test(item.reason ?? ''),
    );
    if (feedback.length < 5 || corrections.length / feedback.length < 0.3)
      continue;
    findings.push({
      ...base(agentName, 'POOR_CLASSIFICATION', 'feedback', now),
      severity: corrections.length / feedback.length > 0.6 ? 'HIGH' : 'MEDIUM',
      title: `${agentName} classifications are frequently corrected`,
      description: `${corrections.length} of ${feedback.length} feedback records indicate classification problems.`,
      evidence: {
        observedValue: corrections.length / feedback.length,
        expectedValue: '< 0.3',
        examples: corrections.slice(0, 3).map((item) => ({
          description: item.reason ?? 'classification correction',
        })),
      },
      confidence: 0.88,
      recommendation: {
        type: 'PROMPT_CHANGE',
        title: 'Add the corrected edge cases to classification guidance',
        rationale:
          'User/downstream corrections provide direct evidence of taxonomy errors.',
        proposal: {
          promptDiff: {
            add: corrections.slice(0, 3).map((item) => item.reason),
          },
        },
      },
    });
  }
  return findings;
};

export const detectStaleSources = (
  runs: RunObservation[],
  now: Date,
): Finding[] =>
  calculateSourceHealth(runs, now).flatMap((health): Finding[] => {
    const medianDays = health.historicalMedianUpdateDays;
    const staleDays = health.staleDays;
    if (
      health.totalRuns < 5 ||
      medianDays === undefined ||
      staleDays === undefined ||
      staleDays < Math.max(7, medianDays * 4)
    )
      return [];
    return [
      {
        ...base(health.agentName, 'STALE_SOURCE', health.sourceId, now),
        severity: staleDays > medianDays * 10 ? 'HIGH' : 'MEDIUM',
        title: `${health.sourceId} appears stale`,
        description: `No new items for ${staleDays.toFixed(1)} days versus a ${medianDays.toFixed(1)} day historical median.`,
        evidence: {
          sourceId: health.sourceId,
          observedValue: staleDays,
          expectedValue: `< ${Math.max(7, medianDays * 4).toFixed(1)} days`,
        },
        confidence: 0.9,
        recommendation: {
          type: 'SCRAPER_CHANGE',
          title: `Verify ${health.sourceId} parsing and upstream activity`,
          rationale:
            'Successful fetches without content exceed the source-specific cadence.',
        },
      },
    ];
  });

export const detectPerformance = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  for (const agentName of new Set(runs.map((run) => run.agentName))) {
    const selected = runs.filter((run) => run.agentName === agentName);
    const latencies = selected.flatMap((run) =>
      run.latencyMs == null ? [] : [run.latencyMs],
    );
    const middle = Math.floor(latencies.length / 2);
    const prior = median(latencies.slice(0, middle));
    const current = median(latencies.slice(middle));
    const p95 = percentile(latencies, 0.95);
    if (
      latencies.length >= 6 &&
      prior &&
      current &&
      current > prior * 2 &&
      current - prior > 10_000
    ) {
      findings.push({
        ...base(agentName, 'HIGH_LATENCY', 'run', now),
        severity: current > prior * 4 ? 'HIGH' : 'MEDIUM',
        title: `${agentName} run latency regressed`,
        description: `Recent median latency is ${Math.round(current)} ms versus ${Math.round(prior)} ms.`,
        evidence: {
          observedValue: current,
          expectedValue: prior,
          p95,
          baseline: rollingBaseline(latencies),
        },
        confidence: 0.86,
        recommendation: {
          type: 'CONFIG_CHANGE',
          title: 'Profile source and LLM latency before changing concurrency',
          rationale:
            'The robust recent median is more than twice the prior baseline.',
        },
      });
    }
    const costs = selected.flatMap((run) =>
      run.llmCostUsd == null ? [] : [run.llmCostUsd],
    );
    const costMiddle = Math.floor(costs.length / 2);
    const priorCost = median(costs.slice(0, costMiddle));
    const currentCost = median(costs.slice(costMiddle));
    if (
      costs.length >= 6 &&
      priorCost &&
      currentCost &&
      currentCost > priorCost * 2
    ) {
      findings.push({
        ...base(agentName, 'HIGH_COST', 'llm', now),
        severity: 'MEDIUM',
        title: `${agentName} LLM cost increased`,
        description: `Recent median cost is ${currentCost.toFixed(6)} USD versus ${priorCost.toFixed(6)} USD.`,
        evidence: { observedValue: currentCost, expectedValue: priorCost },
        confidence: 0.84,
        recommendation: {
          type: 'MODEL_CHANGE',
          title:
            'Reduce duplicate context or route deterministic cases before the LLM',
          rationale:
            'Cost rose materially relative to this agent’s own baseline.',
        },
      });
    }
  }
  return findings;
};

export const detectSourceDegradationAndSchedules = (
  runs: RunObservation[],
  now: Date,
): Finding[] => {
  const findings: Finding[] = [];
  for (const health of calculateSourceHealth(runs, now)) {
    if (health.totalRuns >= 5 && health.successRate < 0.75) {
      findings.push({
        ...base(health.agentName, 'SOURCE_DEGRADATION', health.sourceId, now),
        severity: health.successRate < 0.5 ? 'HIGH' : 'MEDIUM',
        title: `${health.sourceId} source quality is degraded`,
        description: `Source success rate is ${Math.round(health.successRate * 100)}%.`,
        evidence: {
          sourceId: health.sourceId,
          observedValue: health.successRate,
          expectedValue: '>= 0.75',
        },
        confidence: 0.9,
        recommendation: {
          type: 'SOURCE_CHANGE',
          title: `Review ${health.sourceId} reliability and fallback`,
          rationale:
            'Observed source reliability is below the operational baseline.',
        },
      });
    }
    if (
      health.totalRuns >= 8 &&
      health.historicalMedianUpdateDays !== undefined &&
      health.itemsProduced > 0
    ) {
      const rows = runs
        .filter((run) => run.agentName === health.agentName)
        .flatMap((run) => run.sources)
        .filter((source) => source.sourceId === health.sourceId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const pollIntervals = rows
        .slice(1)
        .map(
          (row, index) =>
            (row.createdAt.getTime() - rows[index]!.createdAt.getTime()) /
            86_400_000,
        );
      const pollMedian = median(pollIntervals);
      if (pollMedian && pollMedian * 8 < health.historicalMedianUpdateDays) {
        findings.push({
          ...base(health.agentName, 'SCHEDULE_ISSUE', health.sourceId, now),
          severity: 'LOW',
          title: `${health.sourceId} may be polled too frequently`,
          description:
            'Polling cadence is far shorter than observed content cadence.',
          evidence: {
            sourceId: health.sourceId,
            observedValue: pollMedian,
            expectedValue: health.historicalMedianUpdateDays,
          },
          confidence: 0.78,
          recommendation: {
            type: 'SCHEDULE_CHANGE',
            title: `Review the ${health.sourceId} polling interval`,
            rationale:
              'The source is polled at least eight times faster than it publishes.',
            proposal: {
              configDiff: {
                intervalDays: configDiff(
                  pollMedian,
                  health.historicalMedianUpdateDays / 2,
                ),
              },
            },
          },
        });
      }
    }
  }
  return findings;
};

export const detectAll = (
  runs: RunObservation[],
  now = new Date(),
): Finding[] => {
  const all = [
    ...detectRecurringFailures(runs, now),
    ...detectNoisyOutput(runs, now),
    ...detectLowValueOutput(runs, now),
    ...detectBriefingUsageMismatch(runs, now),
    ...detectDuplicateOutput(runs, now),
    ...detectPoorClassification(runs, now),
    ...detectStaleSources(runs, now),
    ...detectPerformance(runs, now),
    ...detectSourceDegradationAndSchedules(runs, now),
  ];
  return [
    ...new Map(all.map((finding) => [finding.fingerprint, finding])).values(),
  ];
};

export const prioritizeForBriefing = (
  findings: Finding[],
  limit = 10,
): Finding[] => {
  const rank: Record<Severity, number> = {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    INFO: 1,
  };
  return findings
    .filter((finding) => rank[finding.severity] >= rank.MEDIUM)
    .sort(
      (a, b) =>
        rank[b.severity] - rank[a.severity] || b.confidence - a.confidence,
    )
    .slice(0, limit);
};
