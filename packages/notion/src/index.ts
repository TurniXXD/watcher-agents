import { z } from 'zod';

const notionListSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});
const notionObjectSchema = z.record(z.string(), z.unknown());
export type NotionObject = z.infer<typeof notionObjectSchema>;

export class NotionApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'NotionApiError';
  }
}

type NotionClientOptions = {
  apiKey: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maximumAttempts?: number;
};
type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
  idempotent?: boolean;
};
const errorSchema = z
  .object({ code: z.string().optional(), message: z.string().optional() })
  .catchall(z.unknown());
const responseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export class NotionClient {
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maximumAttempts: number;

  public constructor(private readonly options: NotionClientOptions) {
    this.apiVersion = options.apiVersion ?? '2026-03-11';
    this.baseUrl = options.baseUrl ?? 'https://api.notion.com/v1';
    this.fetcher = options.fetch ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maximumAttempts = options.maximumAttempts ?? 4;
  }

  public async queryDataSource(
    dataSourceId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return notionListSchema.parse(
      await this.request(`/data_sources/${dataSourceId}/query`, {
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
        idempotent: true,
      }),
    );
  }

  public async retrievePage(pageId: string, signal?: AbortSignal) {
    return notionObjectSchema.parse(
      await this.request(`/pages/${pageId}`, {
        ...(signal ? { signal } : {}),
        idempotent: true,
      }),
    );
  }

  public async createPage(body: Record<string, unknown>, signal?: AbortSignal) {
    return notionObjectSchema.parse(
      await this.request('/pages', {
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
      }),
    );
  }

  public async updatePage(
    pageId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return notionObjectSchema.parse(
      await this.request(`/pages/${pageId}`, {
        method: 'PATCH',
        body,
        ...(signal ? { signal } : {}),
        idempotent: true,
      }),
    );
  }

  public async listBlockChildren(
    blockId: string,
    startCursor?: string,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ page_size: '100' });
    if (startCursor) query.set('start_cursor', startCursor);
    return notionListSchema.parse(
      await this.request(`/blocks/${blockId}/children?${query.toString()}`, {
        ...(signal ? { signal } : {}),
        idempotent: true,
      }),
    );
  }

  public async updateBlock(
    blockId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return notionObjectSchema.parse(
      await this.request(`/blocks/${blockId}`, {
        method: 'PATCH',
        body,
        ...(signal ? { signal } : {}),
        idempotent: true,
      }),
    );
  }

  public async appendBlockChildren(
    blockId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return notionObjectSchema.parse(
      await this.request(`/blocks/${blockId}/children`, {
        method: 'PATCH',
        body,
        ...(signal ? { signal } : {}),
        idempotent: true,
      }),
    );
  }

  public async createDatabase(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return notionObjectSchema.parse(
      await this.request('/databases', {
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
      }),
    );
  }

  public async createView(body: Record<string, unknown>, signal?: AbortSignal) {
    return notionObjectSchema.parse(
      await this.request('/views', {
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
      }),
    );
  }

  private async request(
    path: string,
    options: RequestOptions,
    attempt = 0,
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': this.apiVersion,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.ok) return responseJson(response);
    const payload = errorSchema.safeParse(await responseJson(response));
    const code = payload.success ? payload.data.code : undefined;
    const retryable =
      (response.status === 429 && code !== 'public_api_request_blocked') ||
      response.status === 529 ||
      (Boolean(options.idempotent) &&
        [500, 502, 503, 504].includes(response.status));
    if (retryable && attempt + 1 < this.maximumAttempts) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await this.sleep(
        Number.isFinite(retryAfter)
          ? Math.max(0, retryAfter * 1_000)
          : Math.min(30_000, 1_000 * 2 ** attempt),
      );
      return this.request(path, options, attempt + 1);
    }
    throw new NotionApiError(
      response.status,
      code,
      payload.success
        ? (payload.data.message ?? `Notion API returned ${response.status}`)
        : `Notion API returned ${response.status}`,
    );
  }
}
