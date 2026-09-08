import { z } from 'zod';
import type { EventBus } from './core/index.js';

const stockCandidateEventTypeSchema = z.enum([
  'stock.news.discovered',
  'stock.earnings.detected',
  'stock.market_anomaly.detected',
  'stock.event.updated',
]);

const stockCandidatePayloadSchema = z.object({
  configId: z.string().uuid(),
  chatId: z.string().regex(/^-?\d+$/u),
  tickers: z.array(z.string().trim().min(1).max(20)).min(1).max(100),
  sourceIds: z.array(z.string().trim().min(1)).optional(),
});

export type StockCandidateEventType = z.infer<
  typeof stockCandidateEventTypeSchema
>;
export type StockCandidate = {
  type: StockCandidateEventType;
  configId: string;
  chatId: bigint;
  tickers: readonly string[];
  sourceIds?: readonly string[];
};

type ScopedRunner = {
  execute(
    configId: string,
    chatId: bigint,
    trigger: 'SCHEDULED',
    options: {
      targetKeys: ReadonlySet<string>;
      sourceIds?: ReadonlySet<string>;
    },
  ): Promise<unknown>;
};

/** Small in-process queue. Scheduled reconciliation remains the durability net. */
export class StockCandidateProcessor {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #unsubscribe: Array<() => void>;

  public constructor(
    private readonly bus: EventBus,
    private readonly runner: ScopedRunner,
  ) {
    this.#unsubscribe = stockCandidateEventTypeSchema.options.map((type) =>
      bus.subscribe(type, async (event) => {
        const payload = stockCandidatePayloadSchema.parse(event.payload);
        await this.enqueue(payload);
      }),
    );
  }

  private async enqueue(
    payload: z.infer<typeof stockCandidatePayloadSchema>,
  ): Promise<void> {
    const previous = this.#tails.get(payload.configId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.runner.execute(
          payload.configId,
          BigInt(payload.chatId),
          'SCHEDULED',
          {
            targetKeys: new Set(
              payload.tickers.map((ticker) => ticker.toUpperCase()),
            ),
            ...(payload.sourceIds
              ? { sourceIds: new Set(payload.sourceIds) }
              : {}),
          },
        );
      });
    this.#tails.set(payload.configId, next);
    await next.finally(() => {
      if (this.#tails.get(payload.configId) === next)
        this.#tails.delete(payload.configId);
    });
  }

  public async processStockCandidate(candidate: StockCandidate): Promise<void> {
    const type = stockCandidateEventTypeSchema.parse(candidate.type);
    await this.bus.publish({
      type,
      aggregateType: 'STOCK_CANDIDATE',
      aggregateId: candidate.configId,
      payload: {
        configId: candidate.configId,
        chatId: candidate.chatId.toString(),
        tickers: candidate.tickers.map((ticker) => ticker.toUpperCase()),
        ...(candidate.sourceIds ? { sourceIds: [...candidate.sourceIds] } : {}),
      },
    });
  }

  public stop(): void {
    this.#unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}
