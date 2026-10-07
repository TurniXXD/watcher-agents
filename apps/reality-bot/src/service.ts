import type { RealityStore } from '@watcher/database';
import { evaluateListing } from './calculations.js';
import { computeMarketScore } from './report.js';
import {
  investmentModelSchema,
  type EvaluatedListing,
  type RealityListing,
  type RealityMetric,
  type ReportPayload,
  type SourceFailure,
} from './types.js';
import type { RealityProvider } from './providers.js';

type Logger = {
  info(data: unknown, message: string): void;
  warn(data: unknown, message: string): void;
  error(data: unknown, message: string): void;
};

export type RunResult =
  | { status: 'BUSY' }
  | { status: 'COMPLETED'; payload: ReportPayload; alertsSent: number }
  | { status: 'FAILED'; error: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const numeric = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export class RealityService {
  private ingestion:
    | Promise<{
        metrics: RealityMetric[];
        listings: RealityListing[];
        newListings: number;
        failures: SourceFailure[];
      }>
    | undefined;

  public constructor(
    private readonly store: RealityStore,
    private readonly providers:
      readonly RealityProvider[] | (() => Promise<readonly RealityProvider[]>),
    private readonly logger: Logger,
  ) {}

  private async configuredProviders(): Promise<readonly RealityProvider[]> {
    return typeof this.providers === 'function'
      ? this.providers()
      : this.providers;
  }

  private async ingest() {
    if (this.ingestion) return this.ingestion;
    const running = (async () => {
      const providers = await this.configuredProviders();
      const settled = await Promise.allSettled(
        providers.map(async (provider) => ({
          provider,
          result: await provider.fetch(),
        })),
      );
      const metrics: RealityMetric[] = [];
      const listings: RealityListing[] = [];
      const failures: SourceFailure[] = [];
      let newListings = 0;
      for (const [index, result] of settled.entries()) {
        const provider = providers[index]!;
        if (result.status === 'rejected') {
          failures.push({
            source: provider.id,
            error: errorMessage(result.reason),
          });
          continue;
        }
        for (const metric of result.value.result.metrics) {
          await this.store.upsertMetric({
            ...metric,
            raw: metric.raw ?? metric,
          });
          metrics.push(metric);
        }
        const seenBySource = new Map<string, string[]>();
        for (const listing of result.value.result.listings) {
          const saved = await this.store.upsertListing({
            ...listing,
            raw: listing.raw ?? listing,
          });
          if (saved.isNew) newListings += 1;
          const seen = seenBySource.get(listing.source) ?? [];
          seen.push(listing.externalId);
          seenBySource.set(listing.source, seen);
          listings.push(listing);
        }
        const completeSources = new Set(
          result.value.result.completeListingSources ?? [],
        );
        await Promise.all(
          [...seenBySource]
            .filter(([source]) => completeSources.has(source))
            .map(([source, externalIds]) =>
              this.store.markMissingListings(source, externalIds),
            ),
        );
      }
      return { metrics, listings, newListings, failures };
    })().finally(() => {
      if (this.ingestion === running) this.ingestion = undefined;
    });
    this.ingestion = running;
    return running;
  }

  private async evaluateForUser(
    user: Awaited<ReturnType<RealityStore['ensureUser']>>,
  ) {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 14);
    const [storedMetrics, storedListings] = await Promise.all([
      this.store.listMetricHistory(since),
      this.store.listActiveListings(user.locations),
    ]);
    const metrics: RealityMetric[] = storedMetrics.map((metric) => ({
      externalId: metric.externalId,
      source: metric.source,
      category: metric.category as RealityMetric['category'],
      metric: metric.metric,
      ...(metric.location ? { location: metric.location } : {}),
      ...(metric.disposition ? { disposition: metric.disposition } : {}),
      value: Number(metric.value),
      unit: metric.unit,
      period: metric.period,
      observedAt: metric.observedAt,
      ...(metric.sourceUrl ? { sourceUrl: metric.sourceUrl } : {}),
      raw: metric.raw,
    }));
    const model = investmentModelSchema.parse(user.model);
    const mortgageRate =
      metrics.find((metric) => metric.metric === 'REALIZED_MORTGAGE_RATE')
        ?.value ??
      metrics.find((metric) => metric.metric === 'OFFER_MORTGAGE_RATE')
        ?.value ??
      5;
    const rentMetricFor = (location: string, disposition?: string) =>
      metrics.find(
        (metric) =>
          metric.metric === 'RENT_PER_M2' &&
          metric.location === location &&
          (!metric.disposition || metric.disposition === disposition),
      );
    const opportunities: EvaluatedListing[] = storedListings
      .map((entry) => {
        const rent =
          numeric(entry.estimatedMonthlyRentCzk) ??
          (() => {
            const metric = rentMetricFor(
              entry.location,
              entry.disposition ?? undefined,
            );
            return metric
              ? metric.value * Number(entry.floorAreaM2)
              : undefined;
          })();
        const listing: RealityListing = {
          externalId: entry.externalId,
          source: entry.source,
          url: entry.url,
          title: entry.title,
          location: entry.location,
          ...(entry.disposition ? { disposition: entry.disposition } : {}),
          priceCzk: Number(entry.priceCzk),
          floorAreaM2: Number(entry.floorAreaM2),
          ...(rent !== undefined ? { estimatedMonthlyRentCzk: rent } : {}),
          ...(entry.annualOwnerCostsCzk
            ? { annualOwnerCostsCzk: Number(entry.annualOwnerCostsCzk) }
            : {}),
          ...(entry.acquisitionCostsCzk
            ? { acquisitionCostsCzk: Number(entry.acquisitionCostsCzk) }
            : {}),
          ...(entry.localMedianPricePerM2Czk
            ? {
                localMedianPricePerM2Czk: Number(
                  entry.localMedianPricePerM2Czk,
                ),
              }
            : {}),
          ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
          raw: entry.raw,
        };
        return {
          ...listing,
          databaseId: entry.id,
          firstSeenAt: entry.firstSeenAt,
          economics: evaluateListing(
            listing,
            model,
            mortgageRate,
            entry.firstSeenAt,
            entry.prices.map((price) => ({
              priceCzk: Number(price.priceCzk),
              observedAt: price.observedAt,
            })),
          ),
        };
      })
      .filter((listing) => listing.estimatedMonthlyRentCzk !== undefined)
      .sort((left, right) => right.economics.score - left.economics.score);
    return { metrics, opportunities, model, mortgageRate };
  }

  private async sendNewAlerts(
    user: Awaited<ReturnType<RealityStore['ensureUser']>>,
    opportunities: readonly EvaluatedListing[],
    notify: (listing: EvaluatedListing) => Promise<void>,
  ): Promise<number> {
    let sent = 0;
    for (const listing of opportunities) {
      const economics = listing.economics;
      if (
        (economics.grossYieldPercent ?? -Infinity) <
          Number(user.alertGrossYieldPercent) ||
        (economics.discountToLocalPercent ?? Infinity) >
          -Number(user.alertDiscountPercent) ||
        (economics.stressCashflows[
          `${Number(user.alertCashflowRate).toFixed(2)}%`
        ] ?? -Infinity) <= 0
      )
        continue;
      const signature = `${listing.priceCzk}:${listing.estimatedMonthlyRentCzk}:${Number(user.alertCashflowRate)}`;
      if (
        !(await this.store.saveAlert(
          user.id,
          listing.databaseId,
          signature,
          economics.score,
          listing,
        ))
      )
        continue;
      await notify(listing);
      sent += 1;
    }
    return sent;
  }

  public async runForUser(
    telegramChatId: bigint,
    trigger: 'MANUAL' | 'SCHEDULED',
    notifyAlert: (listing: EvaluatedListing) => Promise<void>,
    defaults: {
      timezone: string;
      schedule: string;
      locations: readonly string[];
    },
  ): Promise<RunResult> {
    let user = await this.store.ensureUser(
      telegramChatId,
      defaults.timezone,
      defaults.schedule,
      defaults.locations,
    );
    if (user.locations.length === 0) {
      user = await this.store.updateLocations(user.id, defaults.locations);
    }
    const run = await this.store.claimRun(user.id, trigger);
    if (!run) return { status: 'BUSY' };
    try {
      const ingestion = await this.ingest();
      const evaluated = await this.evaluateForUser(user);
      const alertsSent = await this.sendNewAlerts(
        user,
        evaluated.opportunities,
        notifyAlert,
      );
      const marketScore = computeMarketScore(
        evaluated.metrics,
        evaluated.opportunities,
      );
      const best = evaluated.opportunities[0];
      const verdict = best
        ? best.economics.netYieldPercent !== undefined &&
          best.economics.netYieldPercent >= 5 &&
          best.economics.cashflowCzk > 0
          ? 'Trh nabízí selektivní příležitosti. Upřednostnit net yield nad 5 % a kladné cashflow při aktuální sazbě.'
          : 'Nekupovat podle samotného očekávání sazeb; čekat na cenu, která vytvoří kladné stressované cashflow.'
        : 'Chybí dostatek dat o nabídkách; investiční závěr zatím nelze spolehlivě udělat.';
      const payload: ReportPayload = {
        generatedAt: new Date(),
        marketScore,
        verdict,
        metrics: evaluated.metrics,
        opportunities: evaluated.opportunities,
        sourceFailures: ingestion.failures,
      };
      await this.store.saveReport(
        user.id,
        run.id,
        payload.generatedAt,
        payload,
      );
      await this.store.finishRun(user.id, run.id, {
        status: ingestion.failures.length ? 'PARTIAL' : 'SUCCESS',
        metricsFetched: ingestion.metrics.length,
        listingsFetched: ingestion.listings.length,
        newListings: ingestion.newListings,
        alertsSent,
        sourceFailures: ingestion.failures,
      });
      return { status: 'COMPLETED', payload, alertsSent };
    } catch (error) {
      const message = errorMessage(error);
      await this.store.finishRun(user.id, run.id, {
        status: 'FAILED',
        error: message,
      });
      this.logger.error(
        { err: error, telegramChatId: telegramChatId.toString() },
        'Reality run failed',
      );
      return { status: 'FAILED', error: message };
    }
  }

  public async monitor(
    notify: (chatId: bigint, listing: EvaluatedListing) => Promise<void>,
  ): Promise<void> {
    const ingestion = await this.ingest();
    const users = await this.store.listUsers();
    for (const user of users.filter(({ enabled }) => enabled)) {
      const evaluated = await this.evaluateForUser(user);
      await this.sendNewAlerts(user, evaluated.opportunities, (listing) =>
        notify(user.telegramChatId, listing),
      );
    }
    this.logger.info(
      {
        users: users.length,
        listings: ingestion.listings.length,
        sourceFailures: ingestion.failures.length,
      },
      'Reality opportunity monitoring completed',
    );
  }
}
