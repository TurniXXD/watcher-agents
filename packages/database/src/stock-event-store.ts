import {
  normalizeObservation,
  stockThesisStateSchema,
  type RunIntelligenceSummary,
  type StockAnalysisContext,
  type WatchItem,
} from '@watcher/core';
import {
  extractCanonicalEvent,
  assessSignalCoverage,
  materialityRank,
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
import { jsonObject, prismaJson } from './json.js';
import { StockSpecializedSignalStore } from './specialized-signal-store.js';

type EventStoreOptions = {
  eventCooldownMs: number;
  tickerCooldownMs: number;
  marketAnomalyPolicy: MarketAnomalyPolicy;
  advancedSignalPolicy: AdvancedSignalPolicy;
  availableSourceIds?: ReadonlySet<string>;
};

type EventPreparation = {
  eventId: string;
  eventObservationId?: string;
  ticker: string;
  materiality: CoreMateriality;
  eligibleForAnalysis: boolean;
};

const duplicateWindowMs = 36 * 60 * 60 * 1000;
const chainWindowMs = 24 * 60 * 60 * 1000;

const eventNeedsAnalysis = (
  materiality: CoreMateriality,
  action: CoreEventAction,
): boolean =>
  materialityRank(materiality) >= 2 &&
  action !== 'STORE' &&
  action !== 'STATE_UPDATE';

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

export class StockEventStore {
  private readonly specialized: StockSpecializedSignalStore;

  public constructor(
    private readonly db: DatabaseClient,
    private readonly options: EventStoreOptions,
  ) {
    this.specialized = new StockSpecializedSignalStore(
      db,
      options.marketAnomalyPolicy,
      options.advancedSignalPolicy,
    );
  }

  public async recordObservation(
    runId: string,
    processedItemId: string,
    item: WatchItem,
    discoveredAt: Date,
    context: MaterialityContext = {},
  ): Promise<EventPreparation | undefined> {
    const observation = normalizeObservation('STOCKS', item, discoveredAt);
    const candidate = await this.specialized.enrichCandidate(
      processedItemId,
      observation,
      extractCanonicalEvent(observation, context),
    );
    if (!candidate) return undefined;

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
          linked.event.analysisCompletedAt === null,
      };
    }

    try {
      const preparation = await this.db.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.ticker}), hashtext(${candidate.eventType}))`;
          return this.recordNewObservation(
            transaction,
            runId,
            processedItemId,
            candidate,
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
  ) {
    const exact = await db.canonicalEvent.findUnique({
      where: { fingerprint: candidate.fingerprint },
    });
    if (exact) return exact;

    const anchor = candidate.occurredAt ?? candidate.firstDetectedAt;
    const possible = await db.canonicalEvent.findMany({
      where: {
        ticker: candidate.ticker,
        eventType: candidate.eventType,
        firstDetectedAt: {
          gte: new Date(anchor.getTime() - duplicateWindowMs),
          lte: new Date(anchor.getTime() + duplicateWindowMs),
        },
      },
      orderBy: { firstDetectedAt: 'desc' },
      take: 25,
    });
    if (candidate.eventType === 'EARNINGS') return possible[0] ?? null;
    return (
      possible.find(
        (event) => titleSimilarity(event.title, candidate.title) >= 0.65,
      ) ?? null
    );
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
        event.analysisCompletedAt === null &&
        event.analysisClaimedAt === null,
    };
  }

  private async recordNewObservation(
    db: Prisma.TransactionClient,
    runId: string,
    processedItemId: string,
    candidate: CanonicalEventCandidate,
  ): Promise<EventPreparation> {
    const duplicate = await this.findDuplicate(db, candidate);
    if (duplicate) {
      const promoteEvidence =
        candidate.evidencePriority > duplicate.evidencePriority;
      const promoteMateriality =
        materialityRank(candidate.materiality) >
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
          ...(promoteEvidence
            ? {
                primaryEvidenceId: processedItemId,
                evidencePriority: candidate.evidencePriority,
                title: candidate.title,
              }
            : {}),
          ...(promoteMateriality
            ? {
                materiality: candidate.materiality,
                materialityScore: candidate.materialityScore,
                materialityReasons: prismaJson(candidate.materialityReasons),
                action: candidate.action,
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
          event.analysisCompletedAt === null &&
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
        title: eventCandidate.title,
        fingerprint: eventCandidate.fingerprint,
        occurredAt: eventCandidate.occurredAt,
        firstPublicAt: eventCandidate.firstPublicAt,
        firstDetectedAt: eventCandidate.firstDetectedAt,
        direction: eventCandidate.direction,
        magnitude: prismaJson(eventCandidate.magnitude),
        surprise: eventCandidate.surprise,
        materiality: eventCandidate.materiality,
        materialityScore: eventCandidate.materialityScore,
        materialityReasons: prismaJson(eventCandidate.materialityReasons),
        action: eventCandidate.action,
        evidencePriority: eventCandidate.evidencePriority,
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
        });
        if (eventClaim.count === 0) throw new CooldownBlocked();

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
    const relations = await this.db.eventObservation.findMany({
      where: { runId },
      include: { event: true },
      orderBy: { createdAt: 'asc' },
    });
    if (relations.length === 0) return undefined;
    const events = relations.map((relation) => ({
      eventId: relation.eventId,
      ticker: relation.event.ticker,
      eventType: relation.event.eventType,
      title: relation.event.title,
      materiality: relation.event.materiality,
      action: relation.event.action,
      decision: relation.decision,
      direction: relation.event.direction,
      magnitude: jsonObject(relation.event.magnitude),
    }));
    return {
      events,
      newEventCount: relations.filter(({ createdEvent }) => createdEvent)
        .length,
      duplicateEventCount: relations.filter(
        ({ decision }) => decision === EventDecision.DUPLICATE,
      ).length,
      storedOnlyCount: relations.filter(
        ({ decision }) => decision === EventDecision.STORED,
      ).length,
      cooldownCount: relations.filter(
        ({ decision }) => decision === EventDecision.COOLDOWN,
      ).length,
    };
  }
}
