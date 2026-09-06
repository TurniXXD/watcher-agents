import { isSourceRateLimited, sourceRetryAt } from './source-http-error.js';

export type ProviderRequestPolicy = {
  providerKey?: string;
  maxConcurrency: number;
  minimumSpacingMs: number;
  sharedRateLimitBackoff: boolean;
};

type PendingRequest<T> = {
  operation: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export class ProviderBackoffError extends Error {
  public override readonly name = 'ProviderBackoffError';

  public constructor(public readonly retryAt: Date) {
    super(
      `RATE_LIMITED provider backoff active until ${retryAt.toISOString()}`,
    );
  }
}

export class ProviderRequestLimiter {
  private readonly queue: PendingRequest<unknown>[] = [];
  private active = 0;
  private nextStartAt = 0;
  private backoffUntil = 0;

  public constructor(
    private readonly policy: ProviderRequestPolicy,
    private readonly now: () => number = Date.now,
    private readonly sleep: (durationMs: number) => Promise<void> = (
      durationMs,
    ) => new Promise((resolve) => setTimeout(resolve, durationMs)),
    private readonly defaultRateLimitBackoffMs = 15 * 60_000,
  ) {}

  public run<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        operation,
        resolve,
        reject,
      } as PendingRequest<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    while (
      this.active < Math.max(1, this.policy.maxConcurrency) &&
      this.queue.length > 0
    ) {
      const pending = this.queue.shift()!;
      this.active += 1;
      const current = this.now();
      const waitMs = Math.max(0, this.nextStartAt - current);
      this.nextStartAt =
        Math.max(current, this.nextStartAt) +
        Math.max(0, this.policy.minimumSpacingMs);
      void this.execute(pending, waitMs);
    }
  }

  private async execute(
    pending: PendingRequest<unknown>,
    waitMs: number,
  ): Promise<void> {
    try {
      if (waitMs > 0) await this.sleep(waitMs);
      if (this.backoffUntil > this.now()) {
        throw new ProviderBackoffError(new Date(this.backoffUntil));
      }
      try {
        pending.resolve(await pending.operation());
      } catch (error) {
        if (this.policy.sharedRateLimitBackoff && isSourceRateLimited(error)) {
          this.backoffUntil =
            sourceRetryAt(error)?.getTime() ??
            this.now() + this.defaultRateLimitBackoffMs;
        }
        throw error;
      }
    } catch (error) {
      pending.reject(error);
    } finally {
      this.active -= 1;
      this.drain();
    }
  }
}
