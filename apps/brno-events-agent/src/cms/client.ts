import { z } from 'zod';
import type { CmsEventItem } from './event-item.js';

const resultSchema = z.object({
  index: z.number().int().nonnegative(),
  externalId: z.string().nullable(),
  outcome: z.enum([
    'created',
    'updated',
    'proposed',
    'unchanged',
    'skipped',
    'failed',
  ]),
  id: z.string().optional(),
  reason: z.string().optional(),
  retryable: z.boolean().optional(),
  details: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});
const runSchema = z.object({
  runId: z.string(),
  status: z.enum(['running', 'succeeded', 'partial', 'failed']),
  results: z.array(resultSchema),
});
export type CmsIngestResult = z.infer<typeof resultSchema>;
export type CmsIngestRun = z.infer<typeof runSchema>;

/** Transport-level failure; `retryable` distinguishes outages from rejected requests. */
export class CmsRequestError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export type CmsClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Minimal client for `POST /api/ingest/v1/events`. */
export class ContentCmsClient {
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  public constructor(private readonly options: CmsClientOptions) {
    this.#endpoint = `${options.baseUrl.replace(/\/+$/u, '')}/api/ingest/v1/events`;
    this.#fetch = options.fetch ?? fetch;
  }

  public async ingestEvents(
    items: CmsEventItem[],
    idempotencyKey: string,
  ): Promise<CmsIngestRun> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'watcher-brno-events-agent',
        },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new CmsRequestError(
        `CMS unreachable: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    if (response.status === 200 || response.status === 422) {
      const parsed = runSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success)
        throw new CmsRequestError(
          'CMS returned an unexpected response',
          true,
          response.status,
        );
      return parsed.data;
    }
    const retryable =
      response.status >= 500 ||
      response.status === 429 ||
      response.status === 409;
    throw new CmsRequestError(
      `CMS responded with HTTP ${response.status}`,
      retryable,
      response.status,
    );
  }
}
