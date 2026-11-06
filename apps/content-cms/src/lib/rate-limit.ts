export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * In-memory token bucket. The CMS runs as a single instance, so process-local
 * limits are sufficient; put a shared limiter in front if it is ever scaled out.
 */
export class TokenBucketLimiter {
  readonly #buckets = new Map<string, { tokens: number; updatedAt: number }>();
  readonly #refillPerMs: number;

  public constructor(
    private readonly capacity: number,
    windowMs = 60_000,
    private readonly maxKeys = 10_000,
  ) {
    this.#refillPerMs = capacity / windowMs;
  }

  public consume(key: string, cost = 1, now = Date.now()): RateLimitDecision {
    const bucket = this.#buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + (now - bucket.updatedAt) * this.#refillPerMs,
    );
    bucket.updatedAt = now;
    if (!this.#buckets.has(key) && this.#buckets.size >= this.maxKeys) {
      this.#evict(now);
    }
    this.#buckets.set(key, bucket);
    if (bucket.tokens < cost) {
      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((cost - bucket.tokens) / this.#refillPerMs / 1000),
        ),
      };
    }
    bucket.tokens -= cost;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterSeconds: 0,
    };
  }

  #evict(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (
        bucket.tokens + (now - bucket.updatedAt) * this.#refillPerMs >=
        this.capacity
      ) {
        this.#buckets.delete(key);
      }
    }
    if (this.#buckets.size >= this.maxKeys) {
      const oldest = this.#buckets.keys().next().value;
      if (oldest !== undefined) this.#buckets.delete(oldest);
    }
  }
}
