import { createHash } from 'node:crypto';
import { errorMessage } from '@watcher/core';
import type { SocialTrendStore } from '@watcher/database';
import { z } from 'zod';
import {
  assessMomentum,
  clusterTrendSignals,
  compareMarkets,
  scoreTrendOpportunity,
  trendTokens,
  type ScoreWeights,
} from './analysis.js';
import type { CzechTrendContentAgent } from './content-agent.js';
import {
  trendFingerprint,
  type TrendSignal,
  type TrendSource,
  type TrendSourceId,
} from './types.js';

const weightsSchema = z.object({
  usMomentum: z.number().nonnegative(),
  czechOpportunity: z.number().nonnegative(),
  audienceRelevance: z.number().nonnegative(),
  businessPotential: z.number().nonnegative(),
  contentFeasibility: z.number().nonnegative(),
  evidenceQuality: z.number().nonnegative(),
});

const localDateKey = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const objectiveLabel = (value: string): string =>
  ({
    QUALIFIED_LEADS: 'lead generation',
    CREDIBILITY: 'budování autority',
    PERSONAL_BRAND: 'osobní značka',
    AUDIENCE_GROWTH: 'růst relevantního publika',
    TRAFFIC: 'návštěvnost',
    NEWSLETTER_GROWTH: 'růst newsletteru',
    LEARNING: 'vzdělávání',
  })[value] ?? value;

const marketLabel = (value: string): string =>
  ({
    EARLY_OPPORTUNITY: 'časná česká příležitost',
    EMERGING_BOTH: 'trend vzniká v obou trzích',
    ESTABLISHED: 'v Česku již zavedené',
    UNCERTAIN: 'nejisté kvůli nedostatku dat',
    NOT_RELEVANT: 'pro Česko nerelevantní',
  })[value] ?? value;

const momentumLabel = (value: string): string =>
  ({
    EARLY_EMERGING: 'raný trend',
    RAPIDLY_GROWING: 'rychle rostoucí',
    ESTABLISHED: 'zavedené',
    DECLINING: 'klesající',
    EVERGREEN: 'evergreen',
    UNKNOWN: 'neznámé',
  })[value] ?? value;

export const renderDailyTrendReport = (input: {
  researchDate: string;
  opportunities: readonly {
    title: string;
    description: string;
    opportunityScore: number;
    confidence: number;
    czechMarketStatus: string;
    recommendedFormat: string;
    objective: string;
    estimatedEffortMinutes: number;
    missingData: readonly string[];
    cluster: {
      stage: string;
      signals: readonly {
        source: string;
        sourceUrl: string;
        collectedAt: Date;
      }[];
    };
    concept: {
      hooks: { curiosity: string; problem: string; practical: string };
      cta: string;
    };
  }[];
  sourceStatuses: readonly {
    source: string;
    availability: string;
    error?: string;
  }[];
}): string => {
  const freshest = input.opportunities
    .flatMap(({ cluster }) =>
      cluster.signals.map(({ collectedAt }) => collectedAt),
    )
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const header = [
    `🔭 Trend Intelligence · ${input.researchDate}`,
    `Čerstvost dat: ${freshest?.toISOString() ?? 'žádná data'}`,
    `Zdroje: ${input.sourceStatuses.map(({ source, availability }) => `${source}=${availability}`).join(', ') || 'žádné'}`,
    '',
    'Naměřená fakta jsou počty signálů, dostupné platformní metriky a opakovaná pozorování. Tržní status, relevance a obsahové návrhy jsou transparentní odhady.',
  ];
  if (!input.opportunities.length) {
    return [
      ...header,
      '',
      'Nebyly nalezeny žádné dostatečně relevantní příležitosti. Bot nevytváří výplňová témata.',
    ].join('\n');
  }
  return [
    ...header,
    ...input.opportunities.flatMap((item, index) => [
      '',
      `${index + 1}. ${item.title}`,
      item.description,
      `Platformy: ${[...new Set(item.cluster.signals.map(({ source }) => source))].join(', ')}`,
      `US momentum: ${momentumLabel(item.cluster.stage)}`,
      `Český trh: ${marketLabel(item.czechMarketStatus)}`,
      `Skóre: ${item.opportunityScore}/100 · jistota ${item.confidence}/100`,
      `Formát: ${item.recommendedFormat} · cíl: ${objectiveLabel(item.objective)} · odhad ${item.estimatedEffortMinutes} min`,
      `Hook – zvědavost: ${item.concept.hooks.curiosity}`,
      `Hook – problém: ${item.concept.hooks.problem}`,
      `Hook – prakticky: ${item.concept.hooks.practical}`,
      `CTA: ${item.concept.cta}`,
      `Chybějící data: ${item.missingData.join(', ') || 'žádná zásadní'}`,
      `Zdroje:\n${item.cluster.signals
        .slice(0, 5)
        .map(({ source, sourceUrl }) => `• ${source}: ${sourceUrl}`)
        .join('\n')}`,
    ]),
  ].join('\n');
};

const isRelevant = (
  signal: TrendSignal,
  focusTopics: readonly string[],
  keywords: readonly string[],
): boolean => {
  const metadataKeyword =
    typeof signal.metadata?.keyword === 'string' ? signal.metadata.keyword : '';
  const candidate = new Set(
    trendTokens(
      `${signal.title} ${signal.description ?? ''} ${metadataKeyword}`,
    ),
  );
  const expected = [...focusTopics, ...keywords].flatMap(trendTokens);
  return expected.some((token) => candidate.has(token));
};

export class SocialTrendIntelligence {
  public constructor(
    private readonly options: {
      store: SocialTrendStore;
      sources: readonly TrendSource[];
      contentAgent: CzechTrendContentAgent;
      defaultEnabled: boolean;
      defaultSchedule: string;
      defaultTimezone: string;
      defaultReportSize: number;
      defaultSources: readonly TrendSourceId[];
      logger?: {
        info(data: unknown, message: string): void;
        warn(data: unknown, message: string): void;
      };
    },
  ) {}

  public async ensureProfile(ownerUserId: bigint) {
    return this.options.store.ensureProfile(ownerUserId, new Date(), {
      enabled: this.options.defaultEnabled,
      schedule: this.options.defaultSchedule,
      timezone: this.options.defaultTimezone,
      reportSize: this.options.defaultReportSize,
      enabledSources: this.options.defaultSources,
    });
  }

  public sourceAvailability() {
    return this.options.sources.map((source) => ({
      id: source.id,
      name: source.name,
      enabled: source.enabled,
    }));
  }

  public async importSignals(input: {
    ownerUserId: bigint;
    signals: readonly TrendSignal[];
  }) {
    const unique = new Map(
      input.signals.map((signal) => [trendFingerprint(signal), signal]),
    );
    const stored = [];
    for (const [fingerprint, signal] of unique) {
      stored.push(
        await this.options.store.upsertSignal(input.ownerUserId, {
          ...signal,
          fingerprint,
        }),
      );
    }
    return stored;
  }

  public async run(input: {
    ownerUserId: bigint;
    chatId: bigint;
    trigger: 'MANUAL' | 'SCHEDULED';
    selectedSources?: readonly TrendSourceId[];
    seedSignals?: readonly TrendSignal[];
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const profile = await this.ensureProfile(input.ownerUserId);
    const selected =
      input.selectedSources === undefined
        ? (profile.enabledSources as TrendSourceId[])
        : input.selectedSources;
    const date = localDateKey(now, profile.timezone);
    const idempotencyKey = createHash('sha256')
      .update(
        `${input.ownerUserId}:${date}:${[...selected].sort().join(',')}:${createHash(
          'sha256',
        )
          .update(
            (input.seedSignals ?? [])
              .map((signal) => trendFingerprint(signal))
              .sort()
              .join(','),
          )
          .digest('hex')}`,
      )
      .digest('hex');
    const claim = await this.options.store.startRun({
      ownerUserId: input.ownerUserId,
      chatId: input.chatId,
      idempotencyKey,
      trigger: input.trigger,
      requestedSources: input.seedSignals?.length
        ? [...new Set([...selected, 'MANUAL' as const])]
        : selected,
    });
    const { run } = claim;
    if (run.report) {
      await this.options.store.markProfileRun(
        input.ownerUserId,
        profile.schedule,
        profile.timezone,
        now,
      );
      return run.report;
    }
    if (!claim.claimed || run.status !== 'RUNNING') {
      const existing = await this.options.store.latestReport(input.ownerUserId);
      return existing;
    }
    try {
      const sourceById = new Map(
        this.options.sources.map((source) => [source.id, source]),
      );
      const context = {
        keywords: profile.keywords,
        subreddits: profile.subreddits,
        youtubeChannelIds: profile.youtubeChannelIds,
        regions: ['US', 'CZ'] as const,
        now,
      };
      const settled = await Promise.allSettled(
        selected.map(async (sourceId) => {
          const started = Date.now();
          const source = sourceById.get(sourceId);
          if (!source) {
            return {
              source: sourceId,
              availability: 'UNAVAILABLE' as const,
              signals: [],
              quotaUsed: 0,
              durationMs: Date.now() - started,
              error: 'No adapter is registered',
            };
          }
          try {
            const result = await source.collect(context);
            return { ...result, durationMs: Date.now() - started };
          } catch (error) {
            return {
              source: sourceId,
              availability: 'ERROR' as const,
              signals: [],
              quotaUsed: 0,
              durationMs: Date.now() - started,
              error: errorMessage(error),
            };
          }
        }),
      );
      const sourceResults = settled.flatMap((result) =>
        result.status === 'fulfilled'
          ? [result.value]
          : [
              {
                source: 'MANUAL' as const,
                availability: 'ERROR' as const,
                signals: [],
                quotaUsed: 0,
                durationMs: 0,
                error: errorMessage(result.reason),
              },
            ],
      );
      if (input.seedSignals?.length) {
        sourceResults.push({
          source: 'MANUAL',
          availability: 'ACTIVE',
          signals: [...input.seedSignals],
          quotaUsed: 0,
          durationMs: 0,
        });
      }
      await Promise.all(
        sourceResults.map((result) =>
          this.options.store.recordSourceRun({
            runId: run.id,
            ownerUserId: input.ownerUserId,
            source: result.source,
            status: result.availability,
            itemCount: result.signals.length,
            quotaUsed: result.quotaUsed,
            durationMs: result.durationMs,
            ...(result.error ? { error: result.error } : {}),
            now,
          }),
        ),
      );
      const relevantSignals = sourceResults
        .flatMap(({ signals }) => signals)
        .filter((signal) =>
          isRelevant(signal, profile.focusTopics, profile.keywords),
        );
      const uniqueSignals = new Map<string, TrendSignal>();
      for (const signal of relevantSignals)
        uniqueSignals.set(trendFingerprint(signal), signal);
      const storedSignals: Array<TrendSignal & { id: string }> = [];
      for (const [fingerprint, signal] of uniqueSignals) {
        const stored = await this.options.store.upsertSignal(
          input.ownerUserId,
          {
            ...signal,
            fingerprint,
          },
        );
        storedSignals.push({ ...signal, id: stored.id });
      }
      const clusterCandidates = clusterTrendSignals(storedSignals);
      const weights: ScoreWeights = weightsSchema.parse(profile.scoringWeights);
      const generated = [];
      for (const candidate of clusterCandidates) {
        const cluster = await this.options.store.upsertCluster({
          ownerUserId: input.ownerUserId,
          canonicalKey: candidate.canonicalKey,
          title: candidate.title,
          ...(candidate.description
            ? { description: candidate.description }
            : {}),
          keywords: candidate.keywords,
          stage: 'UNKNOWN',
          signalIds: candidate.signals.map(({ id }) => id),
          now,
        });
        const momentum = assessMomentum(cluster.signals, now);
        const persistedCluster = await this.options.store.upsertCluster({
          ownerUserId: input.ownerUserId,
          canonicalKey: candidate.canonicalKey,
          title: candidate.title,
          ...(candidate.description
            ? { description: candidate.description }
            : {}),
          keywords: candidate.keywords,
          stage: momentum.stage,
          signalIds: candidate.signals.map(({ id }) => id),
          now,
        });
        const comparison = compareMarkets(candidate.signals, true);
        await this.options.store.createMarketComparison({
          clusterId: persistedCluster.id,
          ...comparison,
          researchedAt: now,
        });
        const learning = await this.options.store.clusterLearning(
          input.ownerUserId,
          candidate.canonicalKey,
        );
        const scoring = scoreTrendOpportunity({
          cluster: candidate,
          momentum,
          comparison,
          focusTopics: profile.focusTopics,
          audiences: profile.audiences,
          weights,
          feedback: {
            positive:
              learning.positive +
              learning.publishedItems +
              Math.min(5, learning.qualifiedLeads),
            negative: learning.negative,
            saturated: learning.saturated,
          },
        });
        if (scoring.score < 45) continue;
        const { concept, usedLlm } = await this.options.contentAgent.generate({
          cluster: candidate,
          momentum,
          comparison,
          focusTopics: profile.focusTopics,
          audiences: profile.audiences,
        });
        const fingerprint = createHash('sha256')
          .update(`${input.ownerUserId}:${date}:${candidate.canonicalKey}`)
          .digest('hex');
        const opportunity = await this.options.store.upsertOpportunity({
          ownerUserId: input.ownerUserId,
          runId: run.id,
          clusterId: persistedCluster.id,
          fingerprint,
          title: concept.title,
          description: concept.coreMessage,
          czechMarketStatus: comparison.status,
          opportunityScore: scoring.score,
          confidence: scoring.confidence,
          factors: scoring.factors,
          missingData: scoring.missingData,
          explanation: scoring.explanation,
          evidence: {
            momentum,
            comparison,
            references: candidate.signals.map(
              ({ source, sourceUrl, title }) => ({
                source,
                sourceUrl,
                title,
              }),
            ),
            aiInterpretationUsed: usedLlm,
          },
          contentConcept: concept,
          recommendedChannel: concept.platform,
          recommendedFormat: concept.format,
          objective: concept.businessObjective,
          estimatedEffortMinutes: concept.estimatedEffortMinutes,
        });
        generated.push({
          ...opportunity,
          concept,
          cluster: {
            stage: momentum.stage,
            signals: candidate.signals,
          },
        });
      }
      const top = generated
        .sort(
          (left, right) =>
            right.opportunityScore - left.opportunityScore ||
            right.confidence - left.confidence,
        )
        .slice(0, profile.reportSize);
      const reportText = renderDailyTrendReport({
        researchDate: date,
        opportunities: top,
        sourceStatuses: sourceResults.map((result) => ({
          source: result.source,
          availability: result.availability,
          ...(result.error ? { error: result.error } : {}),
        })),
      });
      const report = await this.options.store.saveReport({
        ownerUserId: input.ownerUserId,
        runId: run.id,
        researchDate: new Date(`${date}T00:00:00.000Z`),
        text: reportText,
        report: {
          sourceStatuses: sourceResults.map((result) => ({
            source: result.source,
            availability: result.availability,
            itemCount: result.signals.length,
            quotaUsed: result.quotaUsed,
            ...(result.error ? { error: result.error } : {}),
          })),
          opportunityIds: top.map(({ id }) => id),
        },
      });
      const sourceFailures = sourceResults.filter(
        ({ availability }) => availability !== 'ACTIVE',
      ).length;
      await this.options.store.finishRun({
        runId: run.id,
        status:
          sourceFailures === sourceResults.length && sourceResults.length
            ? 'FAILED'
            : sourceFailures
              ? 'PARTIAL'
              : 'COMPLETED',
        signalCount: storedSignals.length,
        clusterCount: clusterCandidates.length,
        opportunityCount: top.length,
        sourceFailures,
        now,
      });
      await this.options.store.markProfileRun(
        input.ownerUserId,
        profile.schedule,
        profile.timezone,
        now,
      );
      await this.options.store.cleanup(
        input.ownerUserId,
        profile.retentionDays,
        now,
      );
      this.options.logger?.info(
        {
          socialTrendRunId: run.id,
          signalCount: storedSignals.length,
          opportunityCount: top.length,
          sourceFailures,
        },
        'Social trend intelligence completed',
      );
      return report;
    } catch (error) {
      await this.options.store.finishRun({
        runId: run.id,
        status: 'FAILED',
        signalCount: 0,
        clusterCount: 0,
        opportunityCount: 0,
        sourceFailures: selected.length,
        error: errorMessage(error),
        now,
      });
      throw error;
    }
  }
}
