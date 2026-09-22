import { createHash } from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export class TransportStore {
  public constructor(private readonly db: DatabaseClient) {}

  public ensureUser(telegramChatId: bigint) {
    return this.db.transportUser.upsert({
      where: { telegramChatId },
      create: { telegramChatId },
      update: {},
    });
  }

  public getUser(telegramChatId: bigint) {
    return this.db.transportUser.findUnique({ where: { telegramChatId } });
  }

  public updateUser(
    telegramChatId: bigint,
    data: {
      vehicleProfile?: unknown;
      costSettings?: unknown;
      preferences?: unknown;
      conversation?: unknown;
      onboardingComplete?: boolean;
      automaticDiscovery?: boolean;
    },
  ) {
    return this.db.transportUser.update({
      where: { telegramChatId },
      data: {
        ...(data.vehicleProfile !== undefined
          ? { vehicleProfile: json(data.vehicleProfile) }
          : {}),
        ...(data.costSettings !== undefined
          ? { costSettings: json(data.costSettings) }
          : {}),
        ...(data.preferences !== undefined
          ? { preferences: json(data.preferences) }
          : {}),
        ...(data.conversation !== undefined
          ? {
              conversation:
                data.conversation === null
                  ? Prisma.DbNull
                  : json(data.conversation),
            }
          : {}),
        ...(data.onboardingComplete !== undefined
          ? { onboardingComplete: data.onboardingComplete }
          : {}),
        ...(data.automaticDiscovery !== undefined
          ? { automaticDiscovery: data.automaticDiscovery }
          : {}),
      },
    });
  }

  public listReadyUsers() {
    return this.db.transportUser.findMany({
      where: { onboardingComplete: true, automaticDiscovery: true },
    });
  }

  public async upsertRequest(input: {
    source: string;
    externalId: string;
    sourceUrl?: string;
    normalized: unknown;
    raw: unknown;
    publishedAt: Date;
    expiresAt?: Date;
  }) {
    const normalized = json(input.normalized);
    const raw = json(input.raw);
    const contentHash = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    return this.db.transportRequestObservation.upsert({
      where: {
        source_externalId: {
          source: input.source,
          externalId: input.externalId,
        },
      },
      create: {
        source: input.source,
        externalId: input.externalId,
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        normalized,
        raw,
        contentHash,
        publishedAt: input.publishedAt,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      },
      update: {
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        normalized,
        raw,
        contentHash,
        lastSeenAt: new Date(),
        disappearedAt: null,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      },
    });
  }

  public markMissingRequests(
    source: string,
    seenExternalIds: readonly string[],
    observedAt = new Date(),
  ) {
    return this.db.transportRequestObservation.updateMany({
      where: {
        source,
        disappearedAt: null,
        externalId: { notIn: [...seenExternalIds] },
      },
      data: { disappearedAt: observedAt },
    });
  }

  public createTrip(userId: string, trip: unknown) {
    return this.db.transportPlannedTrip.create({
      data: { userId, trip: json(trip) },
    });
  }

  public latestTrip(userId: string) {
    return this.db.transportPlannedTrip.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  public recordRejections(
    userId: string,
    requestId: string,
    entries: readonly { code: string; explanation: string }[],
    context?: unknown,
  ) {
    if (!entries.length) return Promise.resolve({ count: 0 });
    return this.db.transportRejection.createMany({
      data: entries.map((entry) => ({
        userId,
        requestId,
        ...entry,
        ...(context === undefined ? {} : { context: json(context) }),
      })),
    });
  }

  public saveOpportunity(input: {
    userId: string;
    requestId: string;
    plannedTripId?: string;
    kind: string;
    score: number;
    confidence: string;
    compatibility: string;
    route: unknown;
    economics: unknown;
    warnings: unknown;
  }) {
    const data = {
      userId: input.userId,
      requestId: input.requestId,
      ...(input.plannedTripId ? { plannedTripId: input.plannedTripId } : {}),
      kind: input.kind,
      score: input.score,
      confidence: input.confidence,
      compatibility: input.compatibility,
      route: json(input.route),
      economics: json(input.economics),
      warnings: json(input.warnings),
    };
    return this.db.transportOpportunity
      .findFirst({
        where: {
          userId: input.userId,
          requestId: input.requestId,
          kind: input.kind,
          plannedTripId: input.plannedTripId ?? null,
        },
      })
      .then((existing) =>
        existing
          ? this.db.transportOpportunity.update({
              where: { id: existing.id },
              data: {
                score: input.score,
                confidence: input.confidence,
                compatibility: input.compatibility,
                route: json(input.route),
                economics: json(input.economics),
                warnings: json(input.warnings),
              },
            })
          : this.db.transportOpportunity.create({ data }),
      );
  }

  public markOpportunityNotified(id: string) {
    return this.db.transportOpportunity.update({
      where: { id },
      data: { notifiedAt: new Date() },
    });
  }

  public ignoreOpportunity(id: string) {
    return this.db.transportOpportunity.update({
      where: { id },
      data: { ignoredAt: new Date() },
    });
  }

  public async getFuelPrice(country: string, fuel: string) {
    const entry = await this.db.transportFuelPriceCache.findUnique({
      where: { country_fuel: { country, fuel } },
    });
    return entry
      ? {
          fuel: 'diesel' as const,
          pricePerLiter: entry.pricePerLiter,
          currency: 'CZK' as const,
          source: entry.source,
          updatedAt: entry.sourceUpdatedAt,
          stale: false,
        }
      : undefined;
  }

  public putFuelPrice(
    country: string,
    price: {
      fuel: string;
      pricePerLiter: number;
      currency: string;
      source: string;
      updatedAt: Date;
    },
  ) {
    return this.db.transportFuelPriceCache.upsert({
      where: { country_fuel: { country, fuel: price.fuel } },
      create: {
        country,
        fuel: price.fuel,
        pricePerLiter: price.pricePerLiter,
        currency: price.currency,
        source: price.source,
        sourceUpdatedAt: price.updatedAt,
      },
      update: {
        pricePerLiter: price.pricePerLiter,
        currency: price.currency,
        source: price.source,
        sourceUpdatedAt: price.updatedAt,
        fetchedAt: new Date(),
      },
    });
  }

  public async getRoute(cacheKey: string) {
    const entry = await this.db.transportRouteCache.findFirst({
      where: { cacheKey, expiresAt: { gt: new Date() } },
    });
    return entry?.route;
  }

  public putRoute(
    cacheKey: string,
    route: unknown,
    expiresAt: Date,
    provider: string,
  ) {
    return this.db.transportRouteCache.upsert({
      where: { cacheKey },
      create: { cacheKey, route: json(route), expiresAt, provider },
      update: { route: json(route), expiresAt, provider },
    });
  }

  public async getGeocoding(query: string) {
    const entry = await this.db.transportGeocodingCache.findFirst({
      where: { query, expiresAt: { gt: new Date() } },
    });
    return entry?.location;
  }

  public putGeocoding(
    query: string,
    location: unknown,
    expiresAt: Date,
    provider: string,
  ) {
    return this.db.transportGeocodingCache.upsert({
      where: { query },
      create: { query, location: json(location), expiresAt, provider },
      update: { location: json(location), expiresAt, provider },
    });
  }
}
