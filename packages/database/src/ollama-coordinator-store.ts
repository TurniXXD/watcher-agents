import { randomUUID } from 'node:crypto';
import { errorMessage, type WatcherLogger } from '@watcher/core';
import type {
  OllamaQueueSnapshot,
  OllamaRequestContext,
  OllamaRequestCoordinator,
  OllamaRequestPriority,
} from '@watcher/observability';
import type { DatabaseClient } from './client.js';
import { HEAVY_LOCAL_MODEL_RESOURCE } from './resource-lease-store.js';

const terminalStatuses = ['SUCCEEDED', 'FAILED', 'TIMED_OUT'] as const;
const priorityValue: Record<OllamaRequestPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

const priorityName = (value: number): OllamaRequestPriority =>
  value <= 0 ? 'high' : value >= 2 ? 'low' : 'normal';

const approximateSize = (value: unknown): number | undefined => {
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length;
  } catch {
    return undefined;
  }
};

const rejectionError = (reason: unknown, fallback: string): Error =>
  reason instanceof Error ? reason : new Error(fallback, { cause: reason });

const isTimeoutError = (error: unknown): boolean =>
  /timed?\s*out|timeout|expired|exceeded/iu.test(errorMessage(error));

const wait = (durationMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(rejectionError(signal.reason, 'Ollama queue wait aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, durationMs);
    const abort = (): void => {
      clearTimeout(timer);
      reject(rejectionError(signal?.reason, 'Ollama queue wait aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });

const runWithTimeout = <T>(
  task: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      action();
    };
    const abort = (): void =>
      finish(() =>
        reject(rejectionError(signal?.reason, 'Ollama request aborted')),
      );
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`Ollama request timed out after ${timeoutMs} ms`)),
        ),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    void task().then(
      (result) => finish(() => resolve(result)),
      (error: unknown) =>
        finish(() => reject(rejectionError(error, 'Ollama request failed'))),
    );
  });

export type OllamaCoordinatorOptions = {
  maximumQueueWaitMs?: number;
  pollIntervalMs?: number;
  leaseGraceMs?: number;
  retentionMs?: number;
};

export class PostgresOllamaCoordinator implements OllamaRequestCoordinator {
  readonly #maximumQueueWaitMs: number;
  readonly #pollIntervalMs: number;
  readonly #leaseGraceMs: number;
  readonly #retentionMs: number;

  public constructor(
    private readonly db: DatabaseClient,
    private readonly logger?: WatcherLogger,
    options: OllamaCoordinatorOptions = {},
  ) {
    this.#maximumQueueWaitMs = options.maximumQueueWaitMs ?? 10 * 60_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#leaseGraceMs = options.leaseGraceMs ?? 30_000;
    this.#retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60_000;
  }

  public async run<T>(
    context: OllamaRequestContext,
    task: () => Promise<T>,
  ): Promise<T> {
    const id = randomUUID();
    const queuedAt = new Date();
    const queueExpiresAt = new Date(
      queuedAt.getTime() + this.#maximumQueueWaitMs,
    );
    await this.db.ollamaRequest.create({
      data: {
        id,
        caller: context.caller,
        model: context.model,
        operation: context.operation,
        priority: priorityValue[context.priority],
        status: 'QUEUED',
        queuedAt,
        queueExpiresAt,
        timeoutMs: context.timeoutMs,
        inputSize: context.inputSize ?? null,
      },
    });
    this.logger?.info(
      {
        event: 'ollama_request_queued',
        requestId: id,
        caller: context.caller,
        model: context.model,
        operation: context.operation,
        priority: context.priority,
        timeoutMs: context.timeoutMs,
        inputSize: context.inputSize,
      },
      'Ollama request queued',
    );

    try {
      for (;;) {
        if (context.signal?.aborted) {
          throw context.signal.reason ?? new Error('Ollama request aborted');
        }
        if (Date.now() >= queueExpiresAt.getTime()) {
          throw new Error(
            `Ollama queue wait exceeded ${this.#maximumQueueWaitMs} ms`,
          );
        }
        const acquired = await this.tryRun(id, queuedAt, context, task);
        if (acquired.acquired) return acquired.result;
        await wait(this.#pollIntervalMs, context.signal);
      }
    } catch (error) {
      const timedOut =
        Date.now() >= queueExpiresAt.getTime() || isTimeoutError(error);
      await this.finishRequest(id, {
        status: timedOut ? 'TIMED_OUT' : 'FAILED',
        error: errorMessage(error),
      });
      this.logger?.error(
        {
          event: 'ollama_request_failed',
          requestId: id,
          caller: context.caller,
          model: context.model,
          operation: context.operation,
          queueWaitMs: Date.now() - queuedAt.getTime(),
          error: errorMessage(error),
        },
        'Ollama request failed',
      );
      throw error;
    } finally {
      void this.pruneFinished().catch((error: unknown) =>
        this.logger?.warn(
          { err: error },
          'Could not prune old Ollama request telemetry',
        ),
      );
    }
  }

  private async tryRun<T>(
    id: string,
    queuedAt: Date,
    context: OllamaRequestContext,
    task: () => Promise<T>,
  ): Promise<{ acquired: false } | { acquired: true; result: T }> {
    const leaseTimeoutMs = context.timeoutMs + this.#leaseGraceMs;
    return this.db.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${HEAVY_LOCAL_MODEL_RESOURCE})) AS acquired
        `;
        if (!rows[0]?.acquired) return { acquired: false } as const;

        const now = new Date();
        await transaction.ollamaRequest.updateMany({
          where: {
            OR: [
              { status: 'ACTIVE', leaseExpiresAt: { lte: now } },
              { status: 'QUEUED', queueExpiresAt: { lte: now } },
            ],
          },
          data: {
            status: 'TIMED_OUT',
            finishedAt: now,
            leaseExpiresAt: null,
            error: 'Ollama coordination lease expired',
          },
        });

        const first = await transaction.ollamaRequest.findFirst({
          where: { status: 'QUEUED' },
          orderBy: [{ priority: 'asc' }, { queuedAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (first?.id !== id) return { acquired: false } as const;

        const startedAt = new Date();
        const queueWaitMs = startedAt.getTime() - queuedAt.getTime();
        const leaseExpiresAt = new Date(startedAt.getTime() + leaseTimeoutMs);
        await this.db.ollamaRequest.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            startedAt,
            queueWaitMs,
            leaseExpiresAt,
          },
        });
        const queueSize = await this.db.ollamaRequest.count({
          where: { status: 'QUEUED' },
        });
        this.logger?.info(
          {
            event: 'ollama_request_started',
            requestId: id,
            caller: context.caller,
            model: context.model,
            operation: context.operation,
            queueWaitMs,
            queueSize,
            timeoutMs: context.timeoutMs,
            inputSize: context.inputSize,
          },
          'Ollama request started',
        );

        const requestStartedAt = Date.now();
        try {
          const result = await runWithTimeout(
            task,
            context.timeoutMs,
            context.signal,
          );
          const durationMs = Date.now() - requestStartedAt;
          const outputSize = approximateSize(result);
          await this.finishRequest(id, {
            status: 'SUCCEEDED',
            durationMs,
            ...(outputSize === undefined ? {} : { outputSize }),
          });
          this.logger?.info(
            {
              event: 'ollama_request_completed',
              requestId: id,
              caller: context.caller,
              model: context.model,
              operation: context.operation,
              queueWaitMs,
              durationMs,
              outputSize,
            },
            'Ollama request completed',
          );
          return { acquired: true, result } as const;
        } catch (error) {
          await this.finishRequest(id, {
            status: isTimeoutError(error) ? 'TIMED_OUT' : 'FAILED',
            durationMs: Date.now() - requestStartedAt,
            error: errorMessage(error),
          });
          throw error;
        }
      },
      { maxWait: 10_000, timeout: leaseTimeoutMs },
    );
  }

  private async finishRequest(
    id: string,
    update: {
      status: (typeof terminalStatuses)[number];
      durationMs?: number;
      outputSize?: number;
      error?: string;
    },
  ): Promise<void> {
    await this.db.ollamaRequest.updateMany({
      where: { id, status: { notIn: [...terminalStatuses] } },
      data: {
        status: update.status,
        finishedAt: new Date(),
        leaseExpiresAt: null,
        durationMs: update.durationMs ?? null,
        outputSize: update.outputSize ?? null,
        error: update.error?.slice(0, 2_000) ?? null,
      },
    });
  }

  private async expireStale(now: Date): Promise<void> {
    await Promise.all([
      this.db.ollamaRequest.updateMany({
        where: {
          status: 'ACTIVE',
          leaseExpiresAt: { lte: now },
        },
        data: {
          status: 'TIMED_OUT',
          finishedAt: now,
          leaseExpiresAt: null,
          error: 'Ollama inference lease expired',
        },
      }),
      this.db.ollamaRequest.updateMany({
        where: { status: 'QUEUED', queueExpiresAt: { lte: now } },
        data: {
          status: 'TIMED_OUT',
          finishedAt: now,
          error: 'Ollama queue wait expired',
        },
      }),
    ]);
  }

  public async snapshot(now = new Date()): Promise<OllamaQueueSnapshot> {
    await this.expireStale(now);
    const [active, queued] = await Promise.all([
      this.db.ollamaRequest.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { startedAt: 'asc' },
      }),
      this.db.ollamaRequest.findMany({
        where: { status: 'QUEUED' },
        orderBy: [{ priority: 'asc' }, { queuedAt: 'asc' }],
      }),
    ]);
    return {
      observedAt: now,
      active: active.flatMap((request) =>
        request.startedAt && request.leaseExpiresAt
          ? [
              {
                id: request.id,
                caller: request.caller,
                model: request.model,
                operation: request.operation,
                startedAt: request.startedAt,
                leaseExpiresAt: request.leaseExpiresAt,
                timeoutMs: request.timeoutMs,
              },
            ]
          : [],
      ),
      queued: queued.map((request) => ({
        id: request.id,
        caller: request.caller,
        model: request.model,
        operation: request.operation,
        queuedAt: request.queuedAt,
        priority: priorityName(request.priority),
      })),
    };
  }

  private async pruneFinished(): Promise<void> {
    await this.db.ollamaRequest.deleteMany({
      where: {
        status: { in: [...terminalStatuses] },
        finishedAt: { lt: new Date(Date.now() - this.#retentionMs) },
      },
    });
  }
}
