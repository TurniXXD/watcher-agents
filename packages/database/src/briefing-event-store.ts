import {
  briefingEventSchema,
  type BriefingEvent,
  type BriefingEventQuery,
  type BriefingEventRepository,
  type SavedBriefingEvent,
  type WatcherLogger,
} from '@watcher/core';
import type { ZodError } from 'zod';
import type {
  BriefingEvent as DatabaseBriefingEvent,
  Prisma,
} from './generated/prisma/client.js';
import type { BriefingEventStatus } from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';
import {
  fromDatabaseConfidence,
  fromDatabaseEventStatus,
  fromDatabaseWatcher,
  toDatabaseWatcher,
} from './utils/briefing-mappers.js';
import { prismaJson } from './utils/json.js';

const toBriefingEvent = (record: DatabaseBriefingEvent): BriefingEvent =>
  briefingEventSchema.parse({
    id: record.id,
    watcherBot: fromDatabaseWatcher(record.watcherBot),
    ...(record.externalEventId
      ? { externalEventId: record.externalEventId }
      : {}),
    ...(record.occurredAt
      ? { occurredAt: record.occurredAt.toISOString() }
      : {}),
    ...(record.publishedAt
      ? { publishedAt: record.publishedAt.toISOString() }
      : {}),
    detectedAt: record.detectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    category: record.category,
    ...(record.subcategory ? { subcategory: record.subcategory } : {}),
    title: record.title,
    summary: record.summary,
    importance: record.importance,
    novelty: record.novelty,
    relevance: record.relevance,
    urgency: record.urgency,
    actionable: record.actionable,
    ...(record.action ? { action: record.action } : {}),
    entities: record.entities,
    tags: record.tags,
    sourceUrls: record.sourceUrls,
    ...(record.primarySource ? { primarySource: record.primarySource } : {}),
    confidence: fromDatabaseConfidence(record.confidence),
    status: fromDatabaseEventStatus(record.status),
    ...(record.deduplicationKey
      ? { deduplicationKey: record.deduplicationKey }
      : {}),
    relatedEventIds: record.relatedEventIds,
    ...(record.metadata === null ? {} : { metadata: record.metadata }),
  });

const validationIssues = (error: ZodError) =>
  error.issues.map(({ code, message, path }) => ({ code, message, path }));

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

export class PostgresBriefingEventRepository implements BriefingEventRepository {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly logger?: WatcherLogger,
  ) {}

  public async save(rawEvent: unknown): Promise<SavedBriefingEvent> {
    const validation = briefingEventSchema.safeParse(rawEvent);
    if (!validation.success) {
      this.logger?.warn(
        { issues: validationIssues(validation.error) },
        'Rejected malformed briefing event',
      );
      throw validation.error;
    }

    const event = validation.data;
    const existing = await this.findMatching(event);
    if (existing.length > 1) {
      throw this.identityCollision(event, existing);
    }
    if (existing[0]) return this.updateExisting(existing[0], event);

    try {
      const created = await this.db.briefingEvent.create({
        data: this.createData(event),
      });
      return { event: toBriefingEvent(created), created: true };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;

      const concurrent = await this.findMatching(event);
      if (concurrent.length !== 1) {
        throw this.identityCollision(event, concurrent, error);
      }
      return this.updateExisting(concurrent[0]!, event);
    }
  }

  public async list(query: BriefingEventQuery = {}): Promise<BriefingEvent[]> {
    this.assertValidDate(query.detectedAfter, 'detectedAfter');
    this.assertValidDate(query.detectedThrough, 'detectedThrough');
    const limit = Math.min(500, Math.max(1, Math.trunc(query.limit ?? 100)));
    const records = await this.db.briefingEvent.findMany({
      where: {
        ...(query.watcherBots
          ? {
              watcherBot: {
                in: query.watcherBots.map(toDatabaseWatcher),
              },
            }
          : {}),
        ...(query.statuses
          ? { status: { in: [...query.statuses] as BriefingEventStatus[] } }
          : {}),
        ...(query.detectedAfter || query.detectedThrough
          ? {
              detectedAt: {
                ...(query.detectedAfter ? { gt: query.detectedAfter } : {}),
                ...(query.detectedThrough
                  ? { lte: query.detectedThrough }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return records.map(toBriefingEvent);
  }

  private findMatching(event: BriefingEvent) {
    const watcherBot = toDatabaseWatcher(event.watcherBot);
    const identities: Prisma.BriefingEventWhereInput[] = [{ id: event.id }];
    if (event.externalEventId) {
      identities.push({ watcherBot, externalEventId: event.externalEventId });
    }
    if (event.deduplicationKey) {
      identities.push({
        watcherBot,
        deduplicationKey: event.deduplicationKey,
      });
    }
    return this.db.briefingEvent.findMany({
      where: { OR: identities },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });
  }

  private async updateExisting(
    existing: DatabaseBriefingEvent,
    event: BriefingEvent,
  ): Promise<SavedBriefingEvent> {
    if (existing.watcherBot !== toDatabaseWatcher(event.watcherBot)) {
      throw this.identityCollision(event, [existing]);
    }
    if (event.updatedAt <= existing.updatedAt.toISOString()) {
      return { event: toBriefingEvent(existing), created: false };
    }

    const updated = await this.db.briefingEvent.update({
      where: { id: existing.id },
      data: {
        externalEventId: event.externalEventId ?? null,
        occurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
        publishedAt: event.publishedAt ? new Date(event.publishedAt) : null,
        detectedAt: new Date(event.detectedAt),
        updatedAt: new Date(event.updatedAt),
        category: event.category,
        subcategory: event.subcategory ?? null,
        title: event.title,
        summary: event.summary,
        importance: event.importance,
        novelty: event.novelty,
        relevance: event.relevance,
        urgency: event.urgency,
        actionable: event.actionable,
        action: event.action ?? null,
        entities: prismaJson(event.entities),
        tags: event.tags,
        sourceUrls: event.sourceUrls,
        primarySource: event.primarySource ?? null,
        confidence: event.confidence,
        status: event.status,
        deduplicationKey: event.deduplicationKey ?? null,
        relatedEventIds: event.relatedEventIds ?? [],
        ...(event.metadata === undefined
          ? {}
          : { metadata: prismaJson(event.metadata) }),
      },
    });
    return { event: toBriefingEvent(updated), created: false };
  }

  private createData(event: BriefingEvent): Prisma.BriefingEventCreateInput {
    return {
      id: event.id,
      watcherBot: toDatabaseWatcher(event.watcherBot),
      externalEventId: event.externalEventId ?? null,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
      publishedAt: event.publishedAt ? new Date(event.publishedAt) : null,
      detectedAt: new Date(event.detectedAt),
      createdAt: new Date(event.createdAt),
      updatedAt: new Date(event.updatedAt),
      category: event.category,
      subcategory: event.subcategory ?? null,
      title: event.title,
      summary: event.summary,
      importance: event.importance,
      novelty: event.novelty,
      relevance: event.relevance,
      urgency: event.urgency,
      actionable: event.actionable,
      action: event.action ?? null,
      entities: prismaJson(event.entities),
      tags: event.tags,
      sourceUrls: event.sourceUrls,
      primarySource: event.primarySource ?? null,
      confidence: event.confidence,
      status: event.status,
      deduplicationKey: event.deduplicationKey ?? null,
      relatedEventIds: event.relatedEventIds ?? [],
      ...(event.metadata === undefined
        ? {}
        : { metadata: prismaJson(event.metadata) }),
    };
  }

  private identityCollision(
    event: BriefingEvent,
    matches: readonly DatabaseBriefingEvent[],
    cause?: unknown,
  ): Error {
    this.logger?.error(
      {
        briefingEventId: event.id,
        watcherBot: event.watcherBot,
        matchingIds: matches.map(({ id }) => id),
        ...(cause ? { err: cause } : {}),
      },
      'Briefing event identity collision',
    );
    return new Error(`Conflicting identities for briefing event ${event.id}`);
  }

  private assertValidDate(value: Date | undefined, field: string): void {
    if (value && Number.isNaN(value.getTime())) {
      throw new Error(`${field} must be a valid Date`);
    }
  }
}
