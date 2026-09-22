import type { TransportStore } from '@watcher/database';
import {
  costSettingsSchema,
  defaultCostRates,
  defaultPreferences,
  plannedTripSchema,
  preferencesSchema,
  vehicleProfileSchema,
} from './config.js';
import type { EvaluatedOpportunity, OpportunityEngine } from './engine.js';
import type {
  FuelPriceProvider,
  TransportRequestProvider,
} from './providers.js';
import type { Opportunity, PlannedTrip, TransportRequest } from './types.js';

type Logger = {
  info(data: unknown, message: string): void;
  warn(data: unknown, message: string): void;
  error(data: unknown, message: string): void;
};

export type RunResult = {
  opportunities: Array<{ id: string; opportunity: Opportunity }>;
  requestCount: number;
  rejectedCount: number;
  sourceFailures: Array<{ source: string; error: string }>;
  configurationIssue?: string;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class TransportOpportunityService {
  private running = false;

  public constructor(
    private readonly store: TransportStore,
    private readonly providers: readonly TransportRequestProvider[],
    private readonly fuelPrices: FuelPriceProvider,
    private readonly engine: OpportunityEngine,
    private readonly logger: Logger,
  ) {}

  public async initializeUser(telegramChatId: bigint) {
    const user = await this.store.ensureUser(telegramChatId);
    if (user.preferences && user.costSettings) return user;
    let costSettings: Record<string, unknown> | undefined;
    if (!user.costSettings) {
      try {
        const price = await this.fuelPrices.getCurrentPrice({ country: 'CZ' });
        costSettings = {
          ...defaultCostRates,
          fuelPriceCzkPerLiter: price.pricePerLiter,
          fuelPriceSource: price.source,
          fuelPriceUpdatedAt: price.updatedAt,
          fuelPriceStale: price.stale,
        };
      } catch (error) {
        this.logger.warn(
          { err: error, telegramChatId: telegramChatId.toString() },
          'Initial fuel price unavailable; user can enter a manual price',
        );
      }
    }
    return this.store.updateUser(telegramChatId, {
      ...(user.preferences ? {} : { preferences: defaultPreferences }),
      ...(costSettings ? { costSettings } : {}),
    });
  }

  private async ingest(): Promise<{
    requests: Array<{ id: string; request: TransportRequest }>;
    failures: Array<{ source: string; error: string }>;
  }> {
    const settled = await Promise.allSettled(
      this.providers.map(async (provider) => ({
        provider,
        requests: await provider.fetchRequests(),
      })),
    );
    const requests: Array<{ id: string; request: TransportRequest }> = [];
    const failures: Array<{ source: string; error: string }> = [];
    for (const [index, result] of settled.entries()) {
      const provider = this.providers[index]!;
      if (result.status === 'rejected') {
        failures.push({
          source: provider.id,
          error: errorMessage(result.reason),
        });
        continue;
      }
      const seenBySource = new Map<string, string[]>();
      for (const request of result.value.requests) {
        const seen = seenBySource.get(request.source) ?? [];
        seen.push(request.externalId);
        seenBySource.set(request.source, seen);
        const observation = await this.store.upsertRequest({
          source: request.source,
          externalId: request.externalId,
          ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {}),
          normalized: request,
          raw: request.raw,
          publishedAt: request.publishedAt,
          ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
        });
        requests.push({ id: observation.id, request });
      }
      await Promise.all(
        [...seenBySource].map(([source, externalIds]) =>
          this.store.markMissingRequests(source, externalIds),
        ),
      );
    }
    return { requests, failures };
  }

  private async evaluate(
    user: Awaited<ReturnType<TransportStore['getUser']>> & {},
    requests: Array<{ id: string; request: TransportRequest }>,
    trip?: {
      id: string;
      value: PlannedTrip;
      kind: 'PLANNED_TRIP' | 'RETURN_LOAD';
    },
    onlyUnnotified = false,
  ): Promise<RunResult['opportunities']> {
    if (
      !user ||
      !user.vehicleProfile ||
      !user.costSettings ||
      !user.preferences
    )
      return [];
    const vehicle = vehicleProfileSchema.parse(user.vehicleProfile);
    const costs = costSettingsSchema.parse(user.costSettings);
    const preferences = preferencesSchema.parse(user.preferences);
    const output: RunResult['opportunities'] = [];
    for (const entry of requests) {
      let result: EvaluatedOpportunity;
      try {
        result = trip
          ? await this.engine.evaluatePlannedTrip({
              request: entry.request,
              trip: trip.value,
              vehicle,
              costs,
              preferences,
              kind: trip.kind,
            })
          : await this.engine.evaluateIndividual({
              request: entry.request,
              vehicle,
              costs,
              preferences,
            });
      } catch (error) {
        await this.store.recordRejections(user.id, entry.id, [
          { code: 'EVALUATION_FAILED', explanation: errorMessage(error) },
        ]);
        continue;
      }
      if (!result.accepted) {
        await this.store.recordRejections(
          user.id,
          entry.id,
          result.rejections,
          {
            plannedTripId: trip?.id,
          },
        );
        continue;
      }
      const saved = await this.store.saveOpportunity({
        userId: user.id,
        requestId: entry.id,
        ...(trip ? { plannedTripId: trip.id } : {}),
        kind: result.opportunity.kind,
        score: result.opportunity.score,
        confidence: result.opportunity.confidence,
        compatibility: result.opportunity.compatibility.classification,
        route: result.opportunity.route,
        economics: result.opportunity.economics,
        warnings: result.opportunity.warnings,
      });
      if (onlyUnnotified && saved.notifiedAt) continue;
      output.push({ id: saved.id, opportunity: result.opportunity });
    }
    return output.sort((a, b) => b.opportunity.score - a.opportunity.score);
  }

  public async runForUser(
    telegramChatId: bigint,
    plannedTrip?: PlannedTrip,
    kind: 'PLANNED_TRIP' | 'RETURN_LOAD' = 'PLANNED_TRIP',
  ): Promise<RunResult> {
    const user = await this.initializeUser(telegramChatId);
    if (!user.onboardingComplete)
      return {
        opportunities: [],
        requestCount: 0,
        rejectedCount: 0,
        sourceFailures: [],
        configurationIssue: 'Set up your vehicle before searching for jobs.',
      };
    if (!user.costSettings)
      return {
        opportunities: [],
        requestCount: 0,
        rejectedCount: 0,
        sourceFailures: [],
        configurationIssue:
          'The live fuel price is unavailable and no cached value exists. Open 📊 Cost settings and enter a manual diesel price.',
      };
    const ingested = await this.ingest();
    const trip = plannedTrip
      ? await this.store.createTrip(
          user.id,
          plannedTripSchema.parse(plannedTrip),
        )
      : undefined;
    const opportunities = await this.evaluate(
      user,
      ingested.requests,
      trip
        ? { id: trip.id, value: plannedTripSchema.parse(trip.trip), kind }
        : undefined,
    );
    return {
      opportunities,
      requestCount: ingested.requests.length,
      rejectedCount: ingested.requests.length - opportunities.length,
      sourceFailures: ingested.failures,
    };
  }

  public async runScheduled(
    notify: (
      chatId: bigint,
      id: string,
      opportunity: Opportunity,
    ) => Promise<void>,
  ): Promise<void> {
    if (this.running) {
      this.logger.warn(
        {},
        'Transport discovery skipped because a prior run is active',
      );
      return;
    }
    this.running = true;
    try {
      const ingested = await this.ingest();
      const users = await this.store.listReadyUsers();
      for (const user of users) {
        const opportunities = await this.evaluate(
          user,
          ingested.requests,
          undefined,
          true,
        );
        for (const item of opportunities.slice(0, 3)) {
          await notify(user.telegramChatId, item.id, item.opportunity);
          await this.store.markOpportunityNotified(item.id);
        }
      }
      this.logger.info(
        {
          users: users.length,
          requests: ingested.requests.length,
          sourceFailures: ingested.failures,
        },
        'Transport discovery completed',
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Transport discovery failed');
    } finally {
      this.running = false;
    }
  }
}
