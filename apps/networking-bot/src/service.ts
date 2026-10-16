import { assertPublicHttpUrl } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';

export class NetworkingService {
  public constructor(private readonly store: SocialsStore) {}

  public async discoverEvents(
    ownerUserId: bigint,
    chatId: bigint,
    options?: { freeOnly?: boolean; now?: Date },
  ) {
    const settings = await this.store.ensureSettings(ownerUserId, chatId);
    const now = options?.now ?? new Date();
    const until = new Date(now.getTime() + 8 * 24 * 60 * 60_000);
    await this.store.importBrnoEvents(ownerUserId, now, until);
    const events = await this.store.listNetworkingEvents({
      ownerUserId,
      from: now,
      to: until,
      cities: settings.preferredCities,
      ...(options?.freeOnly === undefined
        ? {}
        : { freeOnly: options.freeOnly }),
      limit: Math.max(settings.weeklyRecommendationCount * 3, 20),
    });
    return events
      .sort(
        (left, right) =>
          Number(right.priceStatus === 'FREE') -
            Number(left.priceStatus === 'FREE') ||
          right.relevanceScore - left.relevanceScore ||
          left.startAt.getTime() - right.startAt.getTime(),
      )
      .slice(0, settings.weeklyRecommendationCount);
  }

  public addManualEvent(input: {
    ownerUserId: bigint;
    title: string;
    startAt: Date;
    city?: string;
    sourceUrl: string;
    priceStatus?: 'FREE' | 'PAID' | 'UNKNOWN';
  }) {
    const sourceUrl = assertPublicHttpUrl(input.sourceUrl).toString();
    return this.store.addManualEvent({ ...input, sourceUrl });
  }
}
