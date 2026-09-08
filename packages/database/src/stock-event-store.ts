import { createHash, randomUUID } from 'node:crypto';
import {
  finiteNumber,
  normalizeObservation,
  stockThesisStateSchema,
  type RunIntelligenceSummary,
  type StockAnalysisContext,
  type WatchItem,
  type WatcherLogger,
} from '@watcher/core';
import {
  extractCanonicalEvent,
  assessSignalCoverage,
  evaluateMateriality,
  materialityRank,
  normalizedTitleTokens,
  titleSimilarity,
  type AdvancedSignalPolicy,
  type CanonicalEventCandidate,
  type EventAction as CoreEventAction,
  type MarketAnomalyPolicy,
  type Materiality as CoreMateriality,
  type MaterialityContext,
} from './stock-domain/index.js';
import type { DatabaseClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import { EventDecision, Materiality } from './generated/prisma/enums.js';
import { jsonObject, prismaJson } from './utils/json.js';
import { StockSpecializedSignalStore } from './specialized-signal-store.js';
import { StockEventVectorStore } from './stock-event-vector-store.js';

type EmbeddingProvider = {
  embed(input: readonly string[], signal?: AbortSignal): Promise<number[][]>;
};

type EventStoreOptions = {
  eventCooldownMs: number;
  tickerCooldownMs: number;
  marketAnomalyPolicy: MarketAnomalyPolicy;
  advancedSignalPolicy: AdvancedSignalPolicy;
  availableSourceIds?: ReadonlySet<string>;
  semantic?: {
    model: string;
    provider: EmbeddingProvider;
    minimumSimilarity: number;
    windowHours: number;
  };
  logger?: WatcherLogger;
};

type EventPreparation = {
  eventId: string;
  eventObservationId?: string;
  ticker: string;
  materiality: CoreMateriality;
  eligibleForAnalysis: boolean;
};

type SemanticEvaluation = {
  vector?: number[];
  inputHash?: string;
  eventId?: string;
  embeddingCalls: number;
  semanticCandidatesChecked: number;
  semanticClustersMatched: number;
  embeddingFailures: number;
};

const duplicateWindowMs = 36 * 60 * 60 * 1000;
const chainWindowMs = 24 * 60 * 60 * 1000;

export const eventNeedsAnalysis = (
  materiality: CoreMateriality,
  action: CoreEventAction,
): boolean =>
  materiality === 'HIGH' ||
  materiality === 'EXTREME' ||
  (materialityRank(materiality) >= 2 &&
    action !== 'STORE' &&
    action !== 'STATE_UPDATE');

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

const earlier = (left: Date | null, right: Date | null): Date | null => {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
};

const jsonStrings = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

export const semanticClusterSupported = (
  candidate: Pick<CanonicalEventCandidate, 'eventTypes' | 'title'> & {
    ticker?: string;
  },
  possible: {
    eventTypes: readonly string[];
    title: string;
    ticker?: string;
  },
): boolean => {
  const quarter = (title: string) =>
    title.match(/\bq[1-4]\b/iu)?.[0]?.toLowerCase();
  if (
    quarter(candidate.title) &&
    quarter(possible.title) &&
    quarter(candidate.title) !== quarter(possible.title)
  )
    return false;
  // Similar vocabulary cannot turn pricing and factory expansion into one event.
  const development = (title: string) =>
    /\b(fab|factory|plant)\b/iu.test(title)
      ? 'facility'
      : /\b(prices?|pricing|tightness|shortage)\b/iu.test(title)
        ? 'pricing'
        : undefined;
  if (
    development(candidate.title) &&
    development(possible.title) &&
    development(candidate.title) !== development(possible.title)
  )
    return false;
  const identitySensitiveTypes = new Set([
    'ACQUISITION',
    'MERGER',
    'DIVESTITURE',
    'PARTNERSHIP',
    'CONTRACT',
    'GOVERNMENT_CONTRACT',
    'ANALYST_REVISION',
  ]);
  const sharedIdentitySensitiveType = candidate.eventTypes.some(
    (type) =>
      identitySensitiveTypes.has(type) && possible.eventTypes.includes(type),
  );
  if (sharedIdentitySensitiveType) {
    const ignored = new Set([
      'acquire',
      'acquires',
      'acquisition',
      'analyst',
      'announces',
      'buys',
      'company',
      'contract',
      'deal',
      'downgrade',
      'downgrades',
      'merger',
      'partnership',
      'price',
      'purchase',
      'purchases',
      'raises',
      'rating',
      'target',
      'upgrade',
      'upgrades',
      candidate.ticker?.toLowerCase() ?? '',
      possible.ticker?.toLowerCase() ?? '',
    ]);
    const identityTokens = (title: string) =>
      [...normalizedTitleTokens(title)].filter((token) => !ignored.has(token));
    const leftIdentity = identityTokens(candidate.title);
    const rightIdentity = new Set(identityTokens(possible.title));
    if (
      leftIdentity.length > 0 &&
      rightIdentity.size > 0 &&
      !leftIdentity.some((token) => rightIdentity.has(token))
    ) {
      return false;
    }
  }
  const catalystFamily = new Set([
    'EARNINGS',
    'GUIDANCE',
    'ANALYST_REVISION',
    'PRICE_MOVE',
    'PRICE_ANOMALY',
    'VOLUME_ANOMALY',
  ]);
  const sharedType = candidate.eventTypes.some((type) =>
    possible.eventTypes.includes(type),
  );
  const sharedCatalystFamily =
    candidate.eventTypes.some((type) => catalystFamily.has(type)) &&
    possible.eventTypes.some((type) => catalystFamily.has(type));
  const deterministicSupport =
    titleSimilarity(candidate.title, possible.title) >= 0.65 ||
    (/\b(earnings|quarter|guidance|results)\b/i.test(candidate.title) &&
      /\b(earnings|quarter|guidance|results)\b/i.test(possible.title));
  return (sharedType || sharedCatalystFamily) && deterministicSupport;
};

export class StockEventStore {
  private readonly specialized: StockSpecializedSignalStore;
  private readonly vectors: StockEventVectorStore;

  public constructor(
    private readonly db: DatabaseClient,
    private readonly options: EventStoreOptions,
  ) {
    this.specialized = new StockSpecializedSignalStore(
      db,
      options.marketAnomalyPolicy,
      options.advancedSignalPolicy,
    );
    this.vectors = new StockEventVectorStore(db);
  }

  private async semanticCandidate(
    candidate: CanonicalEventCandidate,
    item: WatchItem,
  ): Promise<SemanticEvaluation | undefined> {
    const semantic = this.options.semantic;
    if (!semantic) return undefined;
    const text = `${candidate.title}\n${item.content}`
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    const inputHash = createHash('sha256').update(text).digest('hex');
    let embeddingCalls = 0;
    try {
      const cached = await this.vectors.cachedEmbedding(
        semantic.model,
        inputHash,
      );
      if (!cached) embeddingCalls = 1;
      const vector = cached ?? (await semantic.provider.embed([text]))[0];
      if (!vector) throw new Error('Embedding provider returned no vector');
      const anchor = candidate.occurredAt ?? candidate.firstDetectedAt;
      const windowMs = semantic.windowHours * 60 * 60_000;
      const matches = await this.vectors.findClusteringCandidates({
        ticker: candidate.ticker,
        embedding: vector,
        model: semantic.model,
        after: new Date(anchor.getTime() - windowMs),
        before: new Date(anchor.getTime() + windowMs),
        minimumSimilarity: semantic.minimumSimilarity,
      });
      const match = matches.find((possible) =>
        semanticClusterSupported(candidate, possible),
      );
      return {
        ...(match ? { eventId: match.eventId } : {}),
        vector,
        inputHash,
        embeddingCalls,
        semanticCandidatesChecked: matches.length,
        semanticClustersMatched: match ? 1 : 0,
        embeddingFailures: 0,
      };
    } catch (error) {
      this.options.logger?.warn(
        { err: error, ticker: candidate.ticker },
        'Stock event embedding failed; using deterministic clustering',
      );
      return {
        embeddingCalls,
        semanticCandidatesChecked: 0,
        semanticClustersMatched: 0,
        embeddingFailures: 1,
      };
    }
  }

  private async saveEmbedding(
    eventId: string,
    semantic: SemanticEvaluation | undefined,
  ): Promise<number> {
    if (!semantic?.vector || !semantic.inputHash || !this.options.semantic)
      return 0;
    try {
      await this.vectors.saveEmbedding({
        eventId,
        model: this.options.semantic.model,
        inputHash: semantic.inputHash,
        embedding: semantic.vector,
      });
      return 0;
    } catch (error) {
      this.options.logger?.warn(
        { err: error, eventId },
        'Stock event embedding persistence failed; ingestion remains successful',
      );
      return 1;
    }
  }

  private async recordSemanticMetrics(
    runId: string,
    eventId: string,
    ticker: string,
    semantic: SemanticEvaluation | undefined,
    persistenceFailures: number,
  ): Promise<void> {
    if (!semantic) return;
    try {
      await this.db.domainEvent.create({
        data: {
          id: randomUUID(),
          type: 'stock.semantic_clustering.evaluated',
          aggregateType: 'WATCHER_RUN',
          aggregateId: runId,
          occurredAt: new Date(),
          payload: {
            eventId,
            ticker,
            embeddingCalls: semantic.embeddingCalls,
            semanticCandidatesChecked: semantic.semanticCandidatesChecked,
            semanticClustersMatched: semantic.semanticClustersMatched,
            embeddingFailures: semantic.embeddingFailures + persistenceFailures,
          },
        },
      });
    } catch (error) {
      this.options.logger?.warn(
        { err: error, runId, eventId },
        'Stock semantic metrics persistence failed',
      );
    }
  }

  public async recordObservation(
    runId: string,
    processedItemId: string,
    item: WatchItem,
    discoveredAt: Date,
    context: MaterialityContext = {},
  ): Promise<EventPreparation | undefined> {
    const observation = normalizeObservation('STOCKS', item, discoveredAt);
    const enrichedCandidate = await this.specialized.enrichCandidate(
      processedItemId,
      observation,
      extractCanonicalEvent(observation, context),
    );
    if (!enrichedCandidate) return undefined;
    const latestMarket =
      enrichedCandidate.eventType === 'PRICE_ANOMALY' ||
      enrichedCandidate.eventType === 'VOLUME_ANOMALY'
        ? null
        : await this.db.marketSnapshot.findFirst({
            where: {
              ticker: enrichedCandidate.ticker,
              observedAt: {
                gte: new Date(discoveredAt.getTime() - 48 * 60 * 60_000),
              },
            },
            orderBy: { observedAt: 'desc' },
          });
    const magnitudeMarket = enrichedCandidate.magnitude;
    const gate = evaluateMateriality({
      initialMateriality: enrichedCandidate.materiality,
      initialScore: enrichedCandidate.materialityScore,
      initialReasons: enrichedCandidate.materialityReasons,
      eventTypes: enrichedCandidate.eventTypes,
      market: {
        dailyReturnPercent:
          finiteNumber(magnitudeMarket.dailyReturnPercent) ??
          (latestMarket?.dailyReturnPercent === null ||
          latestMarket?.dailyReturnPercent === undefined
            ? null
            : Number(latestMarket.dailyReturnPercent)),
        returnVolatilityRatio:
          finiteNumber(magnitudeMarket.returnVolatilityRatio) ??
          (latestMarket?.returnVolatilityRatio === null ||
          latestMarket?.returnVolatilityRatio === undefined
            ? null
            : Number(latestMarket.returnVolatilityRatio)),
        relativeVolume:
          finiteNumber(magnitudeMarket.relativeVolume) ??
          (latestMarket?.relativeVolume === null ||
          latestMarket?.relativeVolume === undefined
            ? null
            : Number(latestMarket.relativeVolume)),
        gapPercent:
          finiteNumber(magnitudeMarket.gapPercent) ??
          (latestMarket?.gapPercent === null ||
          latestMarket?.gapPercent === undefined
            ? null
            : Number(latestMarket.gapPercent)),
      },
    });
    const candidate: CanonicalEventCandidate = {
      ...enrichedCandidate,
      materiality: gate.materiality,
      materialityScore: gate.score,
      materialityReasons: gate.reasons,
      action: gate.action,
      magnitude: {
        ...enrichedCandidate.magnitude,
        marketAnomalyTriggered: gate.marketAnomalyTriggered,
      },
    };
    const linked = await this.db.eventObservation.findFirst({
      where: { processedItemId },
      include: { event: true },
    });
    if (linked) {
      await this.specialized.syncEvent(
        linked.eventId,
        processedItemId,
        observation,
        candidate,
        linked.event.primaryDriverId,
      );
      return {
        eventId: linked.eventId,
        ticker: linked.event.ticker,
        materiality: linked.event.materiality,
        eligibleForAnalysis:
          eventNeedsAnalysis(linked.event.materiality, linked.event.action) &&
          linked.event.analysisStatus !== 'ANALYZED',
      };
    }
    const semantic = await this.semanticCandidate(candidate, item);

    try {
      const preparation = await this.db.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.ticker}), hashtext('stock-event-cluster'))`;
          return this.recordNewObservation(
            transaction,
            runId,
            processedItemId,
            candidate,
            semantic && 'eventId' in semantic ? semantic.eventId : undefined,
          );
        },
        { timeout: 30_000 },
      );
      await this.syncSpecializedEvent(
        preparation.eventId,
        processedItemId,
        observation,
        candidate,
      );
      const persistenceFailures = await this.saveEmbedding(
        preparation.eventId,
        semantic,
      );
      await this.recordSemanticMetrics(
        runId,
        preparation.eventId,
        candidate.ticker,
        semantic,
        persistenceFailures,
      );
      return preparation;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const preparation = await this.attachToFingerprint(
        runId,
        processedItemId,
        candidate,
      );
      await this.syncSpecializedEvent(
        preparation.eventId,
        processedItemId,
        observation,
        candidate,
      );
      const persistenceFailures = await this.saveEmbedding(
        preparation.eventId,
        semantic,
      );
      await this.recordSemanticMetrics(
        runId,
        preparation.eventId,
        candidate.ticker,
        semantic,
        persistenceFailures,
      );
      return preparation;
    }
  }

  private async syncSpecializedEvent(
    eventId: string,
    processedItemId: string,
    observation: ReturnType<typeof normalizeObservation>,
    candidate: CanonicalEventCandidate,
  ): Promise<void> {
    const event = await this.db.canonicalEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { primaryDriverId: true },
    });
    await this.specialized.syncEvent(
      eventId,
      processedItemId,
      observation,
      candidate,
      event.primaryDriverId,
    );
  }

  private async findDuplicate(
    db: Prisma.TransactionClient,
    candidate: CanonicalEventCandidate,
    semanticEventId?: string,
  ) {
    const exact = await db.canonicalEvent.findUnique({
      where: { fingerprint: candidate.fingerprint },
      include: {
        primaryEvidence: true,
        observations: {
          select: { processedItem: { select: { source: true } } },
        },
      },
    });
    if (exact) return exact;
    if (semanticEventId) {
      const semantic = await db.canonicalEvent.findUnique({
        where: { id: semanticEventId },
        include: {
          primaryEvidence: true,
          observations: {
            select: { processedItem: { select: { source: true } } },
          },
        },
      });
      if (semantic) return semantic;
    }

    const anchor = candidate.firstDetectedAt;
    const possible = await db.canonicalEvent.findMany({
      where: {
        ticker: candidate.ticker,
        firstDetectedAt: {
          gte: new Date(anchor.getTime() - duplicateWindowMs),
          lte: new Date(anchor.getTime() + duplicateWindowMs),
        },
      },
      orderBy: { firstDetectedAt: 'desc' },
      take: 25,
      include: {
        primaryEvidence: true,
        observations: {
          select: { processedItem: { select: { source: true } } },
        },
      },
    });
    const compatible = possible.filter((event) => {
      const existingTypes = new Set(
        event.eventTypes.length > 0 ? event.eventTypes : [event.eventType],
      );
      const sharedType = candidate.eventTypes.some((type) =>
        existingTypes.has(type),
      );
      return (
        (sharedType || semanticClusterSupported(candidate, event)) &&
        semanticClusterSupported(candidate, event)
      );
    });
    return compatible[0] ?? null;
  }

  private async attachToFingerprint(
    runId: string,
    processedItemId: string,
    candidate: CanonicalEventCandidate,
  ): Promise<EventPreparation> {
    const event = await this.db.canonicalEvent.findUniqueOrThrow({
      where: { fingerprint: candidate.fingerprint },
    });
    const observation = await this.db.eventObservation.create({
      data: {
        runId,
        processedItemId,
        eventId: event.id,
        role: 'CONFIRMATION',
        decision: EventDecision.DUPLICATE,
      },
    });
    return {
      eventId: event.id,
      eventObservationId: observation.id,
      ticker: event.ticker,
      materiality: event.materiality,
      eligibleForAnalysis:
        eventNeedsAnalysis(event.materiality, event.action) &&
        event.analysisStatus !== 'ANALYZED' &&
        event.analysisClaimedAt === null,
    };
  }

  private async recordNewObservation(
    db: Prisma.TransactionClient,
    runId: string,
    processedItemId: string,
    candidate: CanonicalEventCandidate,
    semanticEventId?: string,
  ): Promise<EventPreparation> {
    const duplicate = await this.findDuplicate(db, candidate, semanticEventId);
    if (duplicate) {
      const currentEvidence = await db.processedItem.findUniqueOrThrow({
        where: { id: processedItemId },
        select: { source: true },
      });
      const eventTypes = [
        ...new Set([
          ...(duplicate.eventTypes.length > 0
            ? duplicate.eventTypes
            : [duplicate.eventType]),
          ...candidate.eventTypes,
        ]),
      ];
      const mergedMagnitude: Record<string, unknown> = {
        ...jsonObject(duplicate.magnitude),
        ...candidate.magnitude,
        marketAnomalyTriggered:
          jsonObject(duplicate.magnitude).marketAnomalyTriggered === true ||
          candidate.magnitude.marketAnomalyTriggered === true,
      };
      const independentSourceCount = new Set([
        ...duplicate.observations.map(
          ({ processedItem }) => processedItem.source,
        ),
        currentEvidence.source,
      ]).size;
      const reevaluated = evaluateMateriality({
        initialMateriality:
          materialityRank(candidate.materiality) >
          materialityRank(duplicate.materiality)
            ? candidate.materiality
            : duplicate.materiality,
        initialScore: Math.max(
          candidate.materialityScore,
          duplicate.materialityScore,
        ),
        initialReasons: [
          ...jsonStrings(duplicate.materialityReasons),
          ...candidate.materialityReasons,
        ],
        eventTypes,
        market: {
          dailyReturnPercent: finiteNumber(mergedMagnitude.dailyReturnPercent),
          returnVolatilityRatio: finiteNumber(
            mergedMagnitude.returnVolatilityRatio,
          ),
          relativeVolume: finiteNumber(mergedMagnitude.relativeVolume),
          gapPercent: finiteNumber(mergedMagnitude.gapPercent),
        },
        independentSourceCount,
      });
      const promoteEvidence =
        candidate.evidencePriority > duplicate.evidencePriority;
      const promoteMateriality =
        materialityRank(reevaluated.materiality) >
        materialityRank(duplicate.materiality);
      const event = await db.canonicalEvent.update({
        where: { id: duplicate.id },
        data: {
          firstPublicAt: earlier(
            duplicate.firstPublicAt,
            candidate.firstPublicAt,
          ),
          firstDetectedAt: earlier(
            duplicate.firstDetectedAt,
            candidate.firstDetectedAt,
          )!,
          lastSeenAt: candidate.firstDetectedAt,
          eventTypes,
          magnitude: prismaJson(mergedMagnitude),
          materialityScore: Math.max(
            duplicate.materialityScore,
            reevaluated.score,
          ),
          materialityReasons: prismaJson(reevaluated.reasons),
          ...(promoteEvidence
            ? {
                primaryEvidenceId: processedItemId,
                evidencePriority: candidate.evidencePriority,
                title: candidate.title,
              }
            : {}),
          ...(promoteMateriality
            ? {
                materiality: reevaluated.materiality,
                action: reevaluated.action,
                analysisStatus: 'PENDING',
              }
            : {}),
        },
      });
      const relation = await db.eventObservation.create({
        data: {
          runId,
          processedItemId,
          eventId: event.id,
          role: 'CONFIRMATION',
          decision: EventDecision.DUPLICATE,
        },
      });
      return {
        eventId: event.id,
        eventObservationId: relation.id,
        ticker: event.ticker,
        materiality: event.materiality,
        eligibleForAnalysis:
          eventNeedsAnalysis(event.materiality, event.action) &&
          event.analysisStatus !== 'ANALYZED' &&
          event.analysisClaimedAt === null,
      };
    }

    const driver = await this.findPrimaryDriver(db, candidate);
    const eventCandidate =
      driver &&
      (candidate.eventType === 'PRICE_ANOMALY' ||
        candidate.eventType === 'VOLUME_ANOMALY')
        ? {
            ...candidate,
            title: `${candidate.ticker} market reaction after ${driver.title}`,
            magnitude: {
              ...candidate.magnitude,
              cause: 'KNOWN_EVENT',
              unexplained: false,
              primaryDriverEventId: driver.id,
            },
          }
        : candidate;
    const chain = driver
      ? await db.eventChain.findUniqueOrThrow({
          where: { id: driver.chainId },
        })
      : await db.eventChain.create({
          data: { ticker: candidate.ticker },
        });
    const event = await db.canonicalEvent.create({
      data: {
        ticker: eventCandidate.ticker,
        eventType: eventCandidate.eventType,
        eventTypes: eventCandidate.eventTypes,
        title: eventCandidate.title,
        fingerprint: eventCandidate.fingerprint,
        occurredAt: eventCandidate.occurredAt,
        firstPublicAt: eventCandidate.firstPublicAt,
        firstDetectedAt: eventCandidate.firstDetectedAt,
        lastSeenAt: eventCandidate.firstDetectedAt,
        direction: eventCandidate.direction,
        magnitude: prismaJson(eventCandidate.magnitude),
        surprise: eventCandidate.surprise,
        materiality: eventCandidate.materiality,
        materialityScore: eventCandidate.materialityScore,
        materialityReasons: prismaJson(eventCandidate.materialityReasons),
        action: eventCandidate.action,
        evidencePriority: eventCandidate.evidencePriority,
        analysisStatus: eventNeedsAnalysis(
          eventCandidate.materiality,
          eventCandidate.action,
        )
          ? 'PENDING'
          : 'SKIPPED',
        primaryEvidenceId: processedItemId,
        primaryDriverId: driver?.id ?? null,
        chainId: chain.id,
      },
    });
    if (!driver) {
      await db.eventChain.update({
        where: { id: chain.id },
        data: { primaryEventId: event.id },
      });
    }
    const relation = await db.eventObservation.create({
      data: {
        runId,
        processedItemId,
        eventId: event.id,
        role: 'PRIMARY',
        decision: EventDecision.STORED,
        createdEvent: true,
      },
    });
    return {
      eventId: event.id,
      eventObservationId: relation.id,
      ticker: event.ticker,
      materiality: event.materiality,
      eligibleForAnalysis: eventNeedsAnalysis(event.materiality, event.action),
    };
  }

  private async findPrimaryDriver(
    db: Prisma.TransactionClient,
    candidate: CanonicalEventCandidate,
  ) {
    if (
      candidate.eventType !== 'ANALYST_REVISION' &&
      candidate.eventType !== 'PRICE_ANOMALY' &&
      candidate.eventType !== 'VOLUME_ANOMALY' &&
      candidate.eventType !== 'OTHER'
    ) {
      return null;
    }
    return db.canonicalEvent.findFirst({
      where: {
        ticker: candidate.ticker,
        materiality: {
          in: [Materiality.MEDIUM, Materiality.HIGH, Materiality.EXTREME],
        },
        eventType: {
          notIn: [
            'PRICE_ANOMALY',
            'VOLUME_ANOMALY',
            'OPTIONS_ANOMALY',
            'OFF_EXCHANGE_ANOMALY',
          ],
        },
        firstDetectedAt: {
          gte: new Date(candidate.firstDetectedAt.getTime() - chainWindowMs),
          lte: candidate.firstDetectedAt,
        },
      },
      orderBy: { firstDetectedAt: 'desc' },
    });
  }

  public async claimAnalysis(
    preparation: EventPreparation,
    now = new Date(),
  ): Promise<boolean> {
    if (!preparation.eligibleForAnalysis) return false;
    class CooldownBlocked extends Error {}
    try {
      return await this.db.$transaction(async (transaction) => {
        const eventClaim = await transaction.canonicalEvent.updateMany({
          where: {
            id: preparation.eventId,
            OR: [
              { analysisClaimedAt: null },
              {
                analysisClaimedAt: {
                  lte: new Date(now.getTime() - this.options.eventCooldownMs),
                },
              },
            ],
          },
          data: { analysisClaimedAt: now },
          // analysisStatus is explicit so HIGH events can never look intentionally skipped.
        });
        if (eventClaim.count === 0) throw new CooldownBlocked();
        await transaction.canonicalEvent.update({
          where: { id: preparation.eventId },
          data: { analysisStatus: 'ANALYZING', analysisError: null },
        });

        if (
          preparation.materiality !== 'HIGH' &&
          preparation.materiality !== 'EXTREME'
        ) {
          const scopeKey = `TICKER:${preparation.ticker}`;
          const claimed = await transaction.analysisCooldown.updateMany({
            where: { scopeKey, cooldownUntil: { lte: now } },
            data: {
              lastClaimedAt: now,
              cooldownUntil: new Date(
                now.getTime() + this.options.tickerCooldownMs,
              ),
            },
          });
          if (claimed.count === 0) {
            try {
              await transaction.analysisCooldown.create({
                data: {
                  scopeKey,
                  lastClaimedAt: now,
                  cooldownUntil: new Date(
                    now.getTime() + this.options.tickerCooldownMs,
                  ),
                },
              });
            } catch (error) {
              if (isUniqueViolation(error)) throw new CooldownBlocked();
              throw error;
            }
          }
        }
        if (preparation.eventObservationId) {
          await transaction.eventObservation.update({
            where: { id: preparation.eventObservationId },
            data: { decision: EventDecision.ANALYZE },
          });
        }
        return true;
      });
    } catch (error) {
      if (!(error instanceof CooldownBlocked)) throw error;
      if (preparation.eventObservationId) {
        await this.db.eventObservation.update({
          where: { id: preparation.eventObservationId },
          data: { decision: EventDecision.COOLDOWN },
        });
      }
      return false;
    }
  }

  public async getEvidenceContent(eventId: string): Promise<string> {
    const evidence = await this.db.eventObservation.findMany({
      where: { eventId },
      include: { processedItem: true },
      orderBy: { createdAt: 'asc' },
      take: 12,
    });
    return evidence
      .map(({ processedItem: item }) => {
        const title = item.headline ?? item.title;
        const content = item.rawText ?? title;
        return `SOURCE: ${item.source}\nURL: ${item.sourceUrl ?? item.url}\n${title}\n${content.slice(0, 2500)}\nSTRUCTURED FACTS: ${JSON.stringify(item.normalizedFacts)}`;
      })
      .join('\n\n');
  }

  public async getAnalysisContext(
    eventId: string,
    watcherConfigId: string,
  ): Promise<StockAnalysisContext> {
    const event = await this.db.canonicalEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { primaryEvidence: true },
    });
    const watcher = await this.db.watcherConfig.findUniqueOrThrow({
      where: { id: watcherConfigId },
      select: { chatConfigId: true },
    });
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const [
      storedThesis,
      catalysts,
      recentEvents,
      price,
      insiders,
      stock,
      health,
    ] = await Promise.all([
      this.db.companyThesisState.findUnique({
        where: { ticker: event.ticker },
      }),
      this.db.catalyst.findMany({
        where: {
          ticker: event.ticker,
          status: { in: ['UPCOMING', 'ACTIVE'] },
        },
        orderBy: [{ expectedStart: 'asc' }, { impact: 'desc' }],
        take: 20,
      }),
      this.db.canonicalEvent.findMany({
        where: { ticker: event.ticker, id: { not: event.id } },
        orderBy: { firstDetectedAt: 'desc' },
        take: 12,
      }),
      this.db.marketSnapshot.findFirst({
        where: { ticker: event.ticker },
        orderBy: { observedAt: 'desc' },
      }),
      this.db.insiderSignal.findMany({
        where: { ticker: event.ticker, occurredAt: { gte: thirtyDaysAgo } },
        select: { convictionScore: true },
      }),
      this.db.stock.findUnique({
        where: {
          chatConfigId_symbol: {
            chatConfigId: watcher.chatConfigId,
            symbol: event.ticker,
          },
        },
        include: { sources: true },
      }),
      this.db.sourceHealth.findMany({
        where: {
          watcherConfigId,
          target: { startsWith: event.ticker },
        },
      }),
    ]);
    const healthBySource = new Map(
      health.map((entry) => [entry.source, entry]),
    );
    const enabledSources = new Set(
      (stock?.sources ?? [])
        .filter(({ enabled }) => enabled)
        .map(({ source }) => String(source)),
    );
    const { dataAvailability, dataCoverage, dataQuality, materialDataGaps } =
      assessSignalCoverage(
        enabledSources,
        healthBySource,
        this.options.availableSourceIds,
      );
    const parsedSignalGroups = storedThesis
      ? stockThesisStateSchema.shape.signalGroups.safeParse(
          storedThesis.signalGroups,
        )
      : null;
    const currentThesis = storedThesis
      ? stockThesisStateSchema.parse({
          ticker: storedThesis.ticker,
          thesis: storedThesis.thesis,
          verdict: storedThesis.verdict,
          confidence: storedThesis.confidence,
          attentionScore: storedThesis.attentionScore,
          bullScore: storedThesis.bullScore,
          bearScore: storedThesis.bearScore,
          netSignal: storedThesis.netSignal,
          signalGroups: parsedSignalGroups?.success
            ? parsedSignalGroups.data
            : [],
          catalysts: Array.isArray(storedThesis.catalysts)
            ? storedThesis.catalysts
            : [],
          insiderConviction: storedThesis.insiderConviction,
          pricedIn: storedThesis.pricedIn,
          primaryDrivers: Array.isArray(storedThesis.primaryDrivers)
            ? storedThesis.primaryDrivers
            : [],
          risks: Array.isArray(storedThesis.risks) ? storedThesis.risks : [],
          dataCoverage: storedThesis.dataCoverage,
          dataQuality: storedThesis.dataQuality,
          materialDataGaps: Array.isArray(storedThesis.materialDataGaps)
            ? storedThesis.materialDataGaps
            : [],
          decision: storedThesis.decision,
        })
      : null;
    const insiderConviction =
      insiders.length === 0
        ? null
        : Math.max(
            -5,
            Math.min(
              5,
              insiders.reduce(
                (total, insider) => total + insider.convictionScore,
                0,
              ),
            ),
          );
    const eventShape = (entry: {
      id: string;
      ticker: string;
      eventType: string;
      eventTypes: string[];
      title: string;
      materiality: CoreMateriality;
      action: CoreEventAction;
      direction: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL' | 'UNKNOWN';
      magnitude: Prisma.JsonValue;
      occurredAt: Date | null;
      firstPublicAt: Date | null;
      firstDetectedAt: Date;
      primaryDriverId: string | null;
    }) => ({
      id: entry.id,
      ticker: entry.ticker,
      eventType: entry.eventType,
      eventTypes:
        entry.eventTypes.length > 0 ? entry.eventTypes : [entry.eventType],
      title: entry.title,
      materiality: entry.materiality,
      action: entry.action,
      direction: entry.direction,
      magnitude: jsonObject(entry.magnitude),
      occurredAt: entry.occurredAt?.toISOString() ?? null,
      firstPublicAt: entry.firstPublicAt?.toISOString() ?? null,
      firstDetectedAt: entry.firstDetectedAt.toISOString(),
      primaryDriverId: entry.primaryDriverId,
    });
    return {
      event: {
        ...eventShape(event),
        evidence: {
          source: event.primaryEvidence.source,
          sourceType: event.primaryEvidence.sourceType,
          sourceUrl:
            event.primaryEvidence.sourceUrl ?? event.primaryEvidence.url,
          primarySource: event.primaryEvidence.primarySource,
          reliability: event.primaryEvidence.reliability,
        },
      },
      currentThesis,
      knownCatalysts: catalysts.map((catalyst) => ({
        type: catalyst.catalystType,
        description: catalyst.description,
        expectedStart: catalyst.expectedStart?.toISOString() ?? null,
        expectedEnd: catalyst.expectedEnd?.toISOString() ?? null,
        exactDateKnown: catalyst.exactDateKnown,
        proximity: catalyst.proximity,
        impact: catalyst.impact,
        direction: catalyst.direction,
      })),
      recentEvents: recentEvents.map(eventShape),
      currentPriceContext: price
        ? {
            observedAt: price.observedAt.toISOString(),
            close: Number(price.close),
            dailyReturnPercent:
              price.dailyReturnPercent === null
                ? null
                : Number(price.dailyReturnPercent),
            weeklyReturnPercent:
              price.weeklyReturnPercent === null
                ? null
                : Number(price.weeklyReturnPercent),
            monthlyReturnPercent:
              price.monthlyReturnPercent === null
                ? null
                : Number(price.monthlyReturnPercent),
            relativeVolume:
              price.relativeVolume === null
                ? null
                : Number(price.relativeVolume),
            returnVolatilityRatio:
              price.returnVolatilityRatio === null
                ? null
                : Number(price.returnVolatilityRatio),
            gapPercent:
              price.gapPercent === null ? null : Number(price.gapPercent),
            volatilityPercent:
              price.realizedVolatilityPercent === null
                ? null
                : Number(price.realizedVolatilityPercent),
            unexplained: price.unexplained,
          }
        : null,
      dataAvailability,
      dataCoverage,
      dataQuality,
      materialDataGaps,
      insiderConviction,
    };
  }

  public async getRunSummary(
    runId: string,
  ): Promise<RunIntelligenceSummary | undefined> {
    const [relations, semanticEvaluations] = await Promise.all([
      this.db.eventObservation.findMany({
        where: { runId },
        include: {
          event: {
            include: {
              alerts: { where: { runId } },
              primaryEvidence: {
                select: { sourceUrl: true, url: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.domainEvent.findMany({
        where: {
          type: 'stock.semantic_clustering.evaluated',
          aggregateType: 'WATCHER_RUN',
          aggregateId: runId,
        },
        select: { payload: true },
      }),
    ]);
    if (relations.length === 0) return undefined;
    const byEvent = new Map<string, typeof relations>();
    for (const relation of relations) {
      const grouped = byEvent.get(relation.eventId) ?? [];
      grouped.push(relation);
      byEvent.set(relation.eventId, grouped);
    }
    const eventRelations = [...byEvent.values()];
    const eventFor = (group: (typeof relations)[number][]) => group[0]!.event;
    const decisionPriority = {
      ANALYZE: 4,
      COOLDOWN: 3,
      DUPLICATE: 2,
      STORED: 1,
    } as const;
    const events = eventRelations.map((group) => {
      const relation = [...group].sort(
        (left, right) =>
          decisionPriority[right.decision] - decisionPriority[left.decision],
      )[0]!;
      return {
        eventId: relation.eventId,
        ticker: relation.event.ticker,
        eventType: relation.event.eventType,
        eventTypes:
          relation.event.eventTypes.length > 0
            ? relation.event.eventTypes
            : [relation.event.eventType],
        title: relation.event.title,
        sourceUrl:
          relation.event.primaryEvidence.sourceUrl ??
          relation.event.primaryEvidence.url,
        materiality: relation.event.materiality,
        action: relation.event.action,
        decision: relation.decision,
        analysisStatus: relation.event.analysisStatus,
        direction: relation.event.direction,
        magnitude: jsonObject(relation.event.magnitude),
      };
    });
    const high = eventRelations.filter(
      (group) =>
        eventFor(group).materiality === 'HIGH' ||
        eventFor(group).materiality === 'EXTREME',
    );
    const highImportanceSkipped = high.filter(
      (group) => eventFor(group).analysisStatus === 'SKIPPED',
    ).length;
    if (highImportanceSkipped > 0) {
      this.options.logger?.error(
        {
          runId,
          highImportanceSkipped,
          eventIds: high
            .filter((group) => eventFor(group).analysisStatus === 'SKIPPED')
            .map((group) => group[0]!.eventId),
        },
        'HIGH stock events were not analyzed',
      );
    }
    const duplicateEventCount = relations.filter(
      ({ decision }) => decision === EventDecision.DUPLICATE,
    ).length;
    const clusteredObservationCount = relations.filter(
      ({ createdEvent }) => !createdEvent,
    ).length;
    return {
      events,
      newEventCount: relations.filter(({ createdEvent }) => createdEvent)
        .length,
      duplicateEventCount,
      storedOnlyCount: relations.filter(
        ({ decision }) => decision === EventDecision.STORED,
      ).length,
      cooldownCount: relations.filter(
        ({ decision }) => decision === EventDecision.COOLDOWN,
      ).length,
      eventsCreated: relations.filter(({ createdEvent }) => createdEvent)
        .length,
      eventsUpdated: eventRelations.filter((group) =>
        group.some(({ createdEvent }) => !createdEvent),
      ).length,
      eventsClustered: clusteredObservationCount,
      eventsAnalyzed: eventRelations.filter(
        (group) => eventFor(group).analysisStatus === 'ANALYZED',
      ).length,
      eventsSkipped: eventRelations.filter(
        (group) => eventFor(group).analysisStatus === 'SKIPPED',
      ).length,
      analysisFailed: eventRelations.filter(
        (group) => eventFor(group).analysisStatus === 'FAILED',
      ).length,
      highImportanceAnalyzed: high.filter(
        (group) => eventFor(group).analysisStatus === 'ANALYZED',
      ).length,
      highImportanceSkipped,
      marketAnomalyTriggered: eventRelations.filter(
        (group) =>
          jsonObject(eventFor(group).magnitude).marketAnomalyTriggered === true,
      ).length,
      embeddingCalls: semanticEvaluations.reduce(
        (total, { payload }) =>
          total + (finiteNumber(jsonObject(payload).embeddingCalls) ?? 0),
        0,
      ),
      semanticCandidatesChecked: semanticEvaluations.reduce(
        (total, { payload }) =>
          total +
          (finiteNumber(jsonObject(payload).semanticCandidatesChecked) ?? 0),
        0,
      ),
      semanticClustersMatched: semanticEvaluations.reduce(
        (total, { payload }) =>
          total +
          (finiteNumber(jsonObject(payload).semanticClustersMatched) ?? 0),
        0,
      ),
      embeddingFailures: semanticEvaluations.reduce(
        (total, { payload }) =>
          total + (finiteNumber(jsonObject(payload).embeddingFailures) ?? 0),
        0,
      ),
      notificationsQueued: eventRelations.reduce(
        (total, group) => total + eventFor(group).alerts.length,
        0,
      ),
      notificationsMerged: eventRelations.reduce(
        (total, group) =>
          total +
          (eventFor(group).alerts.length ? Math.max(0, group.length - 1) : 0),
        0,
      ),
      notificationsSent: eventRelations.reduce(
        (total, group) =>
          total +
          eventFor(group).alerts.filter(({ sentAt }) => sentAt !== null).length,
        0,
      ),
    };
  }
}
