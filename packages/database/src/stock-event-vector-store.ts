import { z } from 'zod';
import type { DatabaseClient } from './client.js';

const embeddingInputSchema = z.object({
  eventId: z.string().uuid(),
  model: z.string().trim().min(1).max(200),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  embedding: z.array(z.number().finite()).min(1).max(16_384),
});

export type StockSemanticCandidate = {
  eventId: string;
  similarity: number;
  ticker: string;
  title: string;
  eventTypes: string[];
  firstDetectedAt: Date;
};

export type SimilarHistoricalStockEvent = StockSemanticCandidate & {
  ticker: string;
  materiality: string;
  occurredAt: Date | null;
  analysis: unknown;
  marketReaction: {
    dailyReturnPercent: number | null;
    relativeVolume: number | null;
    returnVolatilityRatio: number | null;
  } | null;
};

export class StockEventVectorStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async cachedEmbedding(
    model: string,
    inputHash: string,
  ): Promise<number[] | undefined> {
    const rows = await this.db.$queryRaw<Array<{ embedding: string }>>`
      SELECT "embedding"::text AS "embedding" FROM "CanonicalEvent"
      WHERE "embeddingModel" = ${model} AND "embeddingInputHash" = ${inputHash}
        AND "embedding" IS NOT NULL LIMIT 1
    `;
    return rows[0]
      ? z.array(z.number().finite()).parse(JSON.parse(rows[0].embedding))
      : undefined;
  }

  public async saveEmbedding(rawInput: unknown): Promise<void> {
    const input = embeddingInputSchema.parse(rawInput);
    const vector = `[${input.embedding.join(',')}]`;
    await this.db.$executeRaw`
      UPDATE "CanonicalEvent"
      SET
        "embedding" = ${vector}::vector,
        "embeddingModel" = ${input.model},
        "embeddingInputHash" = ${input.inputHash},
        "embeddingUpdatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.eventId}
        AND (
          "embeddingInputHash" IS DISTINCT FROM ${input.inputHash}
          OR "embeddingModel" IS DISTINCT FROM ${input.model}
        )
    `;
  }

  public async findClusteringCandidates(input: {
    ticker: string;
    embedding: readonly number[];
    model: string;
    after: Date;
    before: Date;
    minimumSimilarity: number;
    limit?: number;
  }): Promise<StockSemanticCandidate[]> {
    const vector = `[${input.embedding.join(',')}]`;
    const rows = await this.db.$queryRaw<
      Array<StockSemanticCandidate & { similarity: number | string }>
    >`
      SELECT
        "id" AS "eventId",
        "ticker",
        "title",
        "eventTypes"::text[] AS "eventTypes",
        "firstDetectedAt",
        1 - ("embedding" <=> ${vector}::vector) AS "similarity"
      FROM "CanonicalEvent"
      WHERE "ticker" = ${input.ticker}
        AND "firstDetectedAt" BETWEEN ${input.after} AND ${input.before}
        AND "embeddingModel" = ${input.model}
        AND "embedding" IS NOT NULL
        AND vector_dims("embedding") = vector_dims(${vector}::vector)
        AND 1 - ("embedding" <=> ${vector}::vector) >= ${input.minimumSimilarity}
      ORDER BY "similarity" DESC
      LIMIT ${input.limit ?? 10}
    `;
    return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
  }

  public async findSimilarHistoricalEvents(
    eventId: string,
    limit = 5,
  ): Promise<SimilarHistoricalStockEvent[]> {
    const rows = await this.db.$queryRaw<
      Array<{
        eventId: string;
        similarity: number | string;
        title: string;
        ticker: string;
        eventTypes: string[];
        materiality: string;
        occurredAt: Date | null;
        firstDetectedAt: Date;
      }>
    >`
      SELECT
        candidate."id" AS "eventId",
        candidate."title",
        candidate."ticker",
        candidate."eventTypes"::text[] AS "eventTypes",
        candidate."materiality"::text AS "materiality",
        candidate."occurredAt",
        candidate."firstDetectedAt",
        1 - (candidate."embedding" <=> current."embedding") AS "similarity"
      FROM "CanonicalEvent" current
      JOIN "CanonicalEvent" candidate ON candidate."id" <> current."id"
      WHERE current."id" = ${eventId}
        AND current."embedding" IS NOT NULL
        AND candidate."embedding" IS NOT NULL
        AND candidate."embeddingModel" = current."embeddingModel"
        AND vector_dims(candidate."embedding") = vector_dims(current."embedding")
        AND candidate."firstDetectedAt" < current."firstDetectedAt"
      ORDER BY candidate."embedding" <=> current."embedding"
      LIMIT ${limit}
    `;
    if (rows.length === 0) return [];
    const ids = rows.map(({ eventId: id }) => id);
    const [revisions, reactions] = await Promise.all([
      this.db.thesisRevision.findMany({
        where: { eventId: { in: ids } },
        select: { eventId: true, targetedAnalysis: true },
      }),
      Promise.all(
        rows.map((row) =>
          this.db.marketSnapshot.findFirst({
            where: {
              ticker: row.ticker,
              observedAt: {
                gte: row.firstDetectedAt,
                lte: new Date(row.firstDetectedAt.getTime() + 48 * 60 * 60_000),
              },
            },
            orderBy: { observedAt: 'asc' },
          }),
        ),
      ),
    ]);
    const analysisByEvent = new Map(
      revisions.map((revision) => [
        revision.eventId,
        revision.targetedAnalysis,
      ]),
    );
    return rows.map((row, index) => {
      const reaction = reactions[index];
      return {
        ...row,
        similarity: Number(row.similarity),
        analysis: analysisByEvent.get(row.eventId) ?? null,
        marketReaction: reaction
          ? {
              dailyReturnPercent:
                reaction.dailyReturnPercent === null
                  ? null
                  : Number(reaction.dailyReturnPercent),
              relativeVolume:
                reaction.relativeVolume === null
                  ? null
                  : Number(reaction.relativeVolume),
              returnVolatilityRatio:
                reaction.returnVolatilityRatio === null
                  ? null
                  : Number(reaction.returnVolatilityRatio),
            }
          : null,
      };
    });
  }
}
