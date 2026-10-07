import { computeNextRun } from '@watcher/core';
import type { Prisma } from './generated/prisma/client.js';
import { RunStatus, RunTrigger } from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const monthStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export type RealityMetricInput = {
  source: string;
  externalId: string;
  category: string;
  metric: string;
  location?: string | undefined;
  disposition?: string | undefined;
  value: number;
  unit: string;
  period: Date;
  observedAt: Date;
  sourceUrl?: string | undefined;
  raw: unknown;
};

export type RealityListingInput = {
  source: string;
  externalId: string;
  url: string;
  title: string;
  location: string;
  disposition?: string | undefined;
  priceCzk: number;
  floorAreaM2: number;
  estimatedMonthlyRentCzk?: number | undefined;
  annualOwnerCostsCzk?: number | undefined;
  acquisitionCostsCzk?: number | undefined;
  localMedianPricePerM2Czk?: number | undefined;
  publishedAt?: Date | undefined;
  raw: unknown;
};

export class RealityStore {
  public constructor(private readonly db: DatabaseClient) {}

  public ensureUser(
    telegramChatId: bigint,
    timezone = 'Europe/Prague',
    reportSchedule = '0 8 1 * *',
    locations: readonly string[] = ['Brno', 'Ostrava', 'Frýdek-Místek'],
  ) {
    return this.db.realityUser.upsert({
      where: { telegramChatId },
      create: {
        telegramChatId,
        timezone,
        reportSchedule,
        locations: [...locations],
        nextReportAt: computeNextRun(reportSchedule, timezone),
      },
      update: {},
    });
  }

  public getUser(telegramChatId: bigint) {
    return this.db.realityUser.findUnique({ where: { telegramChatId } });
  }

  public listUsers() {
    return this.db.realityUser.findMany();
  }

  public listDue(now = new Date()) {
    return this.db.realityUser.findMany({
      where: { enabled: true, nextReportAt: { lte: now } },
      select: { id: true, telegramChatId: true },
    });
  }

  public setEnabled(id: string, enabled: boolean) {
    return this.db.realityUser.update({
      where: { id },
      data: { enabled, ...(enabled ? { nextReportAt: new Date() } : {}) },
    });
  }

  public updateSchedule(id: string, schedule: string, timezone: string) {
    const nextReportAt = computeNextRun(schedule, timezone);
    return this.db.realityUser.update({
      where: { id },
      data: { reportSchedule: schedule, timezone, nextReportAt },
    });
  }

  public updateLocations(id: string, locations: readonly string[]) {
    return this.db.realityUser.update({
      where: { id },
      data: { locations: [...locations] },
    });
  }

  public updateModel(id: string, model: unknown) {
    return this.db.realityUser.update({
      where: { id },
      data: { model: json(model) },
    });
  }

  public async claimRun(userId: string, trigger: 'MANUAL' | 'SCHEDULED') {
    const staleBefore = new Date(Date.now() - 2 * 60 * 60_000);
    return this.db.$transaction(async (transaction) => {
      const claim = await transaction.realityUser.updateMany({
        where: {
          id: userId,
          OR: [{ runInProgress: false }, { runStartedAt: { lt: staleBefore } }],
        },
        data: { runInProgress: true, runStartedAt: new Date() },
      });
      if (claim.count === 0) return undefined;
      return transaction.realityRun.create({
        data: {
          userId,
          trigger:
            trigger === 'MANUAL' ? RunTrigger.MANUAL : RunTrigger.SCHEDULED,
        },
      });
    });
  }

  public async finishRun(
    userId: string,
    runId: string,
    input: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
      metricsFetched?: number;
      listingsFetched?: number;
      newListings?: number;
      alertsSent?: number;
      sourceFailures?: unknown;
      error?: string;
    },
  ): Promise<void> {
    const user = await this.db.realityUser.findUniqueOrThrow({
      where: { id: userId },
      select: { reportSchedule: true, timezone: true },
    });
    const finishedAt = new Date();
    await this.db.$transaction([
      this.db.realityRun.update({
        where: { id: runId },
        data: {
          status: RunStatus[input.status],
          finishedAt,
          metricsFetched: input.metricsFetched ?? 0,
          listingsFetched: input.listingsFetched ?? 0,
          newListings: input.newListings ?? 0,
          alertsSent: input.alertsSent ?? 0,
          sourceFailures: json(input.sourceFailures ?? []),
          ...(input.error ? { error: input.error } : {}),
        },
      }),
      this.db.realityUser.update({
        where: { id: userId },
        data: {
          runInProgress: false,
          runStartedAt: null,
          ...(input.status === 'FAILED' ? {} : { lastReportAt: finishedAt }),
          lastRunStatus: RunStatus[input.status],
          nextReportAt: computeNextRun(
            user.reportSchedule,
            user.timezone,
            finishedAt,
          ),
        },
      }),
    ]);
  }

  public async upsertMetric(input: RealityMetricInput) {
    return this.db.realityMetric.upsert({
      where: {
        source_externalId: {
          source: input.source,
          externalId: input.externalId,
        },
      },
      create: {
        source: input.source,
        externalId: input.externalId,
        category: input.category,
        metric: input.metric,
        ...(input.location ? { location: input.location } : {}),
        ...(input.disposition ? { disposition: input.disposition } : {}),
        value: input.value,
        unit: input.unit,
        period: input.period,
        observedAt: input.observedAt,
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        raw: json(input.raw),
      },
      update: {
        category: input.category,
        metric: input.metric,
        location: input.location ?? null,
        disposition: input.disposition ?? null,
        value: input.value,
        unit: input.unit,
        period: input.period,
        observedAt: input.observedAt,
        sourceUrl: input.sourceUrl ?? null,
        raw: json(input.raw),
      },
    });
  }

  public async upsertListing(
    input: RealityListingInput,
    observedAt = new Date(),
  ) {
    return this.db.$transaction(async (transaction) => {
      const existing = await transaction.realityListing.findUnique({
        where: {
          source_externalId: {
            source: input.source,
            externalId: input.externalId,
          },
        },
      });
      const listing = await transaction.realityListing.upsert({
        where: {
          source_externalId: {
            source: input.source,
            externalId: input.externalId,
          },
        },
        create: {
          source: input.source,
          externalId: input.externalId,
          url: input.url,
          title: input.title,
          location: input.location,
          ...(input.disposition ? { disposition: input.disposition } : {}),
          priceCzk: input.priceCzk,
          floorAreaM2: input.floorAreaM2,
          ...(input.estimatedMonthlyRentCzk !== undefined
            ? { estimatedMonthlyRentCzk: input.estimatedMonthlyRentCzk }
            : {}),
          ...(input.annualOwnerCostsCzk !== undefined
            ? { annualOwnerCostsCzk: input.annualOwnerCostsCzk }
            : {}),
          ...(input.acquisitionCostsCzk !== undefined
            ? { acquisitionCostsCzk: input.acquisitionCostsCzk }
            : {}),
          ...(input.localMedianPricePerM2Czk !== undefined
            ? { localMedianPricePerM2Czk: input.localMedianPricePerM2Czk }
            : {}),
          ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
          raw: json(input.raw),
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
        },
        update: {
          url: input.url,
          title: input.title,
          location: input.location,
          disposition: input.disposition ?? null,
          priceCzk: input.priceCzk,
          floorAreaM2: input.floorAreaM2,
          estimatedMonthlyRentCzk: input.estimatedMonthlyRentCzk ?? null,
          annualOwnerCostsCzk: input.annualOwnerCostsCzk ?? null,
          acquisitionCostsCzk: input.acquisitionCostsCzk ?? null,
          localMedianPricePerM2Czk: input.localMedianPricePerM2Czk ?? null,
          publishedAt: input.publishedAt ?? null,
          lastSeenAt: observedAt,
          disappearedAt: null,
          raw: json(input.raw),
        },
      });
      const priceChanged =
        !existing || Number(existing.priceCzk) !== input.priceCzk;
      if (priceChanged) {
        await transaction.realityListingPrice.create({
          data: { listingId: listing.id, priceCzk: input.priceCzk, observedAt },
        });
      }
      return { listing, isNew: !existing, priceChanged };
    });
  }

  public markMissingListings(
    source: string,
    externalIds: readonly string[],
    observedAt = new Date(),
  ) {
    return this.db.realityListing.updateMany({
      where: {
        source,
        disappearedAt: null,
        externalId: { notIn: [...externalIds] },
      },
      data: { disappearedAt: observedAt },
    });
  }

  public listMetricHistory(since: Date) {
    return this.db.realityMetric.findMany({
      where: { period: { gte: since } },
      orderBy: [{ period: 'desc' }, { metric: 'asc' }],
    });
  }

  public listActiveListings(locations: readonly string[]) {
    return this.db.realityListing.findMany({
      where: { disappearedAt: null, location: { in: [...locations] } },
      include: { prices: { orderBy: { observedAt: 'asc' } } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  public async saveAlert(
    userId: string,
    listingId: string,
    signature: string,
    score: number,
    payload: unknown,
  ): Promise<boolean> {
    const result = await this.db.realityAlert.createMany({
      data: [{ userId, listingId, signature, score, payload: json(payload) }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  public saveReport(
    userId: string,
    runId: string,
    period: Date,
    payload: unknown,
  ) {
    const normalizedPeriod = monthStart(period);
    return this.db.realityReport.upsert({
      where: { userId_period: { userId, period: normalizedPeriod } },
      create: {
        userId,
        runId,
        period: normalizedPeriod,
        payload: json(payload),
      },
      update: { runId, payload: json(payload) },
    });
  }
}
