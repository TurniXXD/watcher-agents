import { removeNullBytesDeep } from '@watcher/core';
import type { DatabaseClient, Prisma } from '@watcher/database';
import type { EventSource, RawEvent } from '../domain/types.js';
import {
  canonicalUrl,
  eventContentHash,
  eventFingerprint,
  normalizeText,
} from '../domain/normalization.js';
import { scoreEvent } from '../services/relevance.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(removeNullBytesDeep(value ?? {})),
  ) as Prisma.InputJsonValue;

export type EventQuery = {
  from?: Date;
  to?: Date;
  minRelevance?: number;
  category?: string;
  source?: string;
  free?: boolean;
  limit: number;
  offset: number;
};

export class EventRepository {
  #saveQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly db: DatabaseClient) {}

  public save(
    source: EventSource,
    raw: RawEvent,
    now = new Date(),
  ): Promise<'created' | 'updated' | 'duplicate'> {
    const save = this.#saveQueue.then(() => this.saveOne(source, raw, now));
    this.#saveQueue = save.then(
      () => undefined,
      () => undefined,
    );
    return save;
  }

  private async saveOne(
    source: EventSource,
    raw: RawEvent,
    now: Date,
  ): Promise<'created' | 'updated' | 'duplicate'> {
    const eventUrl = canonicalUrl(raw.eventUrl);
    const fingerprint = eventFingerprint(raw);
    const contentHash = eventContentHash(raw);
    const direct = await this.db.brnoEventSourceLink.findFirst({
      where: {
        sourceId: source.id,
        OR: [
          { eventUrl },
          ...(raw.externalId ? [{ externalId: raw.externalId }] : []),
        ],
      },
      select: { eventId: true },
    });
    const exactMatch = direct
      ? await this.db.brnoEvent.findUnique({ where: { id: direct.eventId } })
      : await this.db.brnoEvent.findUnique({ where: { fingerprint } });
    const proximityCandidates = exactMatch
      ? []
      : await this.db.brnoEvent.findMany({
          where: {
            normalizedTitle: normalizeText(raw.title),
            startAt: {
              gte: new Date(raw.startAt.getTime() - 30 * 60_000),
              lte: new Date(raw.startAt.getTime() + 30 * 60_000),
            },
          },
          take: 20,
        });
    const venue = normalizeText(
      `${raw.venue?.name ?? ''} ${raw.venue?.address ?? ''}`,
    );
    const organizer = normalizeText(raw.organizer?.name ?? '');
    const matched =
      exactMatch ??
      proximityCandidates.find((candidate) => {
        const candidateVenue = normalizeText(
          `${candidate.venueName ?? ''} ${candidate.venueAddress ?? ''}`,
        );
        const candidateOrganizer = normalizeText(candidate.organizerName ?? '');
        return (
          (venue.length > 0 && venue === candidateVenue) ||
          (organizer.length > 0 && organizer === candidateOrganizer)
        );
      });
    const relevance = scoreEvent(raw, now);
    const data = {
      fingerprint,
      contentHash,
      title: raw.title,
      normalizedTitle: normalizeText(raw.title),
      description: raw.description ?? null,
      startAt: raw.startAt,
      endAt: raw.endAt ?? null,
      venueName: raw.venue?.name ?? null,
      venueAddress: raw.venue?.address ?? null,
      latitude: raw.venue?.latitude ?? null,
      longitude: raw.venue?.longitude ?? null,
      organizerName: raw.organizer?.name ?? null,
      organizerUrl: raw.organizer?.url ?? null,
      categories: raw.categories,
      language: raw.language ?? null,
      priceAmount: raw.price?.amount ?? null,
      priceCurrency: raw.price?.currency ?? null,
      priceFree: raw.price?.free ?? null,
      priceText: raw.price?.text ?? null,
      registrationRequired: raw.registrationRequired ?? null,
      registrationUrl: raw.registrationUrl ?? null,
      registrationDeadline: raw.registrationDeadline ?? null,
      imageUrl: raw.imageUrl ?? null,
      relevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
      recurring: raw.recurring,
      cancelled: raw.cancelled,
      sourceUpdatedAt: raw.sourceUpdatedAt ?? null,
      lastSeenAt: now,
    };
    const changed = matched?.contentHash !== contentHash;
    const event = matched
      ? changed
        ? await this.db.brnoEvent.update({ where: { id: matched.id }, data })
        : await this.db.brnoEvent.update({
            where: { id: matched.id },
            data: { lastSeenAt: now },
          })
      : await this.db.brnoEvent.create({ data });
    await this.db.brnoEventSourceLink.upsert({
      where: { sourceId_eventUrl: { sourceId: source.id, eventUrl } },
      create: {
        eventId: event.id,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        eventUrl,
        externalId: raw.externalId ?? null,
        raw: json(raw.raw),
        lastSeenAt: now,
      },
      update: {
        eventId: event.id,
        externalId: raw.externalId ?? null,
        raw: json(raw.raw),
        lastSeenAt: now,
      },
    });
    if (!matched) return 'created';
    return direct && changed ? 'updated' : 'duplicate';
  }

  public recordRun(
    sourceId: string,
    input: {
      startedAt: Date;
      success: boolean;
      fetched: number;
      created: number;
      updated: number;
      duplicates: number;
      error?: string;
    },
  ) {
    const finishedAt = new Date();
    return this.db.brnoEventSourceRun.create({
      data: {
        sourceId,
        ...input,
        finishedAt,
        durationMs: finishedAt.getTime() - input.startedAt.getTime(),
        error: input.error ?? null,
      },
    });
  }

  public list(query: EventQuery) {
    return this.db.brnoEvent.findMany({
      where: {
        cancelled: false,
        ...(query.from || query.to
          ? {
              startAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
        ...(query.minRelevance !== undefined
          ? { relevanceScore: { gte: query.minRelevance } }
          : {}),
        ...(query.category ? { categories: { has: query.category } } : {}),
        ...(query.free !== undefined ? { priceFree: query.free } : {}),
        ...(query.source
          ? { sourceLinks: { some: { sourceId: query.source } } }
          : {}),
      },
      include: { sourceLinks: true },
      orderBy: [{ relevanceScore: 'desc' }, { startAt: 'asc' }],
      take: query.limit,
      skip: query.offset,
    });
  }
  public get(id: string) {
    return this.db.brnoEvent.findUnique({
      where: { id },
      include: { sourceLinks: true },
    });
  }
  public async latestRuns(): Promise<Map<string, Date>> {
    const rows = await this.db.brnoEventSourceRun.findMany({
      orderBy: { finishedAt: 'desc' },
      distinct: ['sourceId'],
      select: { sourceId: true, finishedAt: true },
    });
    return new Map(rows.map((row) => [row.sourceId, row.finishedAt]));
  }
}
