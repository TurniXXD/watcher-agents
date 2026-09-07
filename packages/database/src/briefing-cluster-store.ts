import {
  briefingEntitySchema,
  briefingEventStatusSchema,
  watcherBotIdSchema,
  type WatcherBotId,
} from '@watcher/core';
import { z } from 'zod';
import type { BriefingStoryCluster } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';
import {
  fromDatabaseWatcher,
  toDatabaseWatcher,
} from './utils/briefing-mappers.js';
import { prismaJson } from './utils/json.js';

const embeddingInputSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  embedding: z.array(z.number().finite()).min(1).max(16_384),
});

export type BriefingEmbeddingState = {
  eventId: string;
  model: string;
  inputHash: string;
};

export type BriefingSemanticPair = {
  leftEventId: string;
  rightEventId: string;
  similarity: number;
};

export const briefingStoryClusterInputSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    eventIds: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(20_000),
    status: briefingEventStatusSchema,
    importance: z.number().int().min(0).max(100),
    novelty: z.number().int().min(0).max(100),
    relevance: z.number().int().min(0).max(100),
    urgency: z.number().int().min(0).max(100),
    actionable: z.boolean(),
    actionItems: z.array(z.string().trim().min(1).max(1_000)).max(100),
    watcherBots: z.array(watcherBotIdSchema).min(1).max(2),
    entities: z.array(briefingEntitySchema).max(100),
    sourceUrls: z.array(z.url()).max(100),
    firstEventAt: z.date(),
    lastEventAt: z.date(),
  })
  .strict()
  .superRefine((cluster, context) => {
    if (cluster.lastEventAt < cluster.firstEventAt) {
      context.addIssue({
        code: 'custom',
        path: ['lastEventAt'],
        message: 'Last event must not precede first event',
      });
    }
    if (new Set(cluster.eventIds).size !== cluster.eventIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['eventIds'],
        message: 'Cluster event IDs must be unique',
      });
    }
  });

export type BriefingStoryClusterRecord = {
  id: string;
  eventIds: string[];
  title: string;
  summary: string;
  status: 'NEW' | 'DEVELOPING' | 'UNCHANGED' | 'RESOLVED';
  importance: number;
  novelty: number;
  relevance: number;
  urgency: number;
  actionable: boolean;
  actionItems: string[];
  watcherBots: WatcherBotId[];
  entities: z.infer<typeof briefingEntitySchema>[];
  sourceUrls: string[];
  firstEventAt: string;
  lastEventAt: string;
};

const toRecord = (
  cluster: BriefingStoryCluster,
  eventIds: string[],
): BriefingStoryClusterRecord => ({
  id: cluster.id,
  eventIds,
  title: cluster.title,
  summary: cluster.summary,
  status: cluster.status,
  importance: cluster.importance,
  novelty: cluster.novelty,
  relevance: cluster.relevance,
  urgency: cluster.urgency,
  actionable: cluster.actionable,
  actionItems: cluster.actionItems,
  watcherBots: cluster.watcherBots.map(fromDatabaseWatcher),
  entities: z.array(briefingEntitySchema).parse(cluster.entities),
  sourceUrls: cluster.sourceUrls,
  firstEventAt: cluster.firstEventAt.toISOString(),
  lastEventAt: cluster.lastEventAt.toISOString(),
});

export class BriefingStoryClusterStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async findIdByEventIds(
    eventIds: readonly string[],
  ): Promise<string | undefined> {
    if (eventIds.length === 0) return undefined;
    const memberships = await this.db.briefingStoryClusterEvent.findMany({
      where: { eventId: { in: [...new Set(eventIds)] } },
      select: { clusterId: true },
      distinct: ['clusterId'],
      take: 2,
    });
    if (memberships.length > 1) {
      throw new Error('Events already belong to conflicting story clusters');
    }
    return memberships[0]?.clusterId;
  }

  public async listEmbeddingStates(
    eventIds: readonly string[],
  ): Promise<BriefingEmbeddingState[]> {
    if (eventIds.length === 0) return [];
    return this.db.$queryRaw<BriefingEmbeddingState[]>`
      SELECT
        "id" AS "eventId",
        "embeddingModel" AS "model",
        "embeddingInputHash" AS "inputHash"
      FROM "briefing_events"
      WHERE "id" = ANY(${[...new Set(eventIds)]}::text[])
        AND "embedding" IS NOT NULL
        AND "embeddingModel" IS NOT NULL
        AND "embeddingInputHash" IS NOT NULL
    `;
  }

  public async saveEmbedding(rawInput: unknown): Promise<void> {
    const input = embeddingInputSchema.parse(rawInput);
    const vector = `[${input.embedding.join(',')}]`;
    await this.db.$executeRaw`
      UPDATE "briefing_events"
      SET
        "embedding" = ${vector}::vector,
        "embeddingModel" = ${input.model},
        "embeddingInputHash" = ${input.inputHash},
        "embeddingUpdatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.eventId}
    `;
  }

  public async findSemanticPairs(input: {
    eventIds: readonly string[];
    model: string;
    minimumSimilarity: number;
    windowHours: number;
  }): Promise<BriefingSemanticPair[]> {
    if (input.eventIds.length < 2) return [];
    const eventIds = [...new Set(input.eventIds)];
    const rows = await this.db.$queryRaw<
      Array<{
        leftEventId: string;
        rightEventId: string;
        similarity: number | string;
      }>
    >`
      SELECT
        left_event."id" AS "leftEventId",
        right_event."id" AS "rightEventId",
        1 - (left_event."embedding" <=> right_event."embedding") AS "similarity"
      FROM "briefing_events" left_event
      JOIN "briefing_events" right_event ON left_event."id" < right_event."id"
      WHERE left_event."id" = ANY(${eventIds}::text[])
        AND right_event."id" = ANY(${eventIds}::text[])
        AND left_event."embeddingModel" = ${input.model}
        AND right_event."embeddingModel" = ${input.model}
        AND vector_dims(left_event."embedding") = vector_dims(right_event."embedding")
        AND ABS(EXTRACT(EPOCH FROM (
          COALESCE(left_event."occurredAt", left_event."publishedAt", left_event."detectedAt") -
          COALESCE(right_event."occurredAt", right_event."publishedAt", right_event."detectedAt")
        ))) <= ${input.windowHours * 3_600}
        AND 1 - (left_event."embedding" <=> right_event."embedding") >= ${input.minimumSimilarity}
      ORDER BY "similarity" DESC
    `;
    return rows.map((row) => ({
      leftEventId: row.leftEventId,
      rightEventId: row.rightEventId,
      similarity: Number(row.similarity),
    }));
  }

  public async save(rawInput: unknown): Promise<BriefingStoryClusterRecord> {
    const input = briefingStoryClusterInputSchema.parse(rawInput);
    return this.db.$transaction(async (transaction) => {
      const eventIds = [...new Set(input.eventIds)];
      const eventsFound = await transaction.briefingEvent.count({
        where: { id: { in: eventIds } },
      });
      if (eventsFound !== eventIds.length) {
        throw new Error('Story cluster references an unknown briefing event');
      }
      const memberships = await transaction.briefingStoryClusterEvent.findMany({
        where: { eventId: { in: eventIds } },
        select: { clusterId: true },
        distinct: ['clusterId'],
        take: 2,
      });
      if (memberships.length > 1) {
        throw new Error('Events already belong to conflicting story clusters');
      }
      const id = memberships[0]?.clusterId ?? input.id;
      const existing = await transaction.briefingStoryCluster.findUnique({
        where: { id },
      });
      const cluster = await transaction.briefingStoryCluster.upsert({
        where: { id },
        create: {
          id,
          title: input.title,
          summary: input.summary,
          status: input.status,
          importance: input.importance,
          novelty: input.novelty,
          relevance: input.relevance,
          urgency: input.urgency,
          actionable: input.actionable,
          actionItems: input.actionItems,
          watcherBots: input.watcherBots.map(toDatabaseWatcher),
          entities: prismaJson(input.entities),
          sourceUrls: input.sourceUrls,
          firstEventAt: input.firstEventAt,
          lastEventAt: input.lastEventAt,
        },
        update: {
          title: input.title,
          summary: input.summary,
          status: input.status,
          importance: input.importance,
          novelty: input.novelty,
          relevance: input.relevance,
          urgency: input.urgency,
          actionable: input.actionable,
          actionItems: input.actionItems,
          watcherBots: input.watcherBots.map(toDatabaseWatcher),
          entities: prismaJson(input.entities),
          sourceUrls: input.sourceUrls,
          firstEventAt:
            existing && existing.firstEventAt < input.firstEventAt
              ? existing.firstEventAt
              : input.firstEventAt,
          lastEventAt:
            existing && existing.lastEventAt > input.lastEventAt
              ? existing.lastEventAt
              : input.lastEventAt,
        },
      });
      await transaction.briefingStoryClusterEvent.createMany({
        data: eventIds.map((eventId) => ({ clusterId: id, eventId })),
        skipDuplicates: true,
      });
      const allMemberships =
        await transaction.briefingStoryClusterEvent.findMany({
          where: { clusterId: id },
          select: { eventId: true },
          orderBy: { eventId: 'asc' },
        });
      return toRecord(
        cluster,
        allMemberships.map(({ eventId }) => eventId),
      );
    });
  }
}
