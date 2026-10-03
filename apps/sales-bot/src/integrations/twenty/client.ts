import { z } from 'zod';
import type { TwentyRecord } from './types.js';

const recordSchema = z.object({ id: z.string().min(1) }).loose();

const capitalize = (value: string): string =>
  `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

export class TwentyRestClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.baseUrl.replace(/\/$/u, '')}/rest/${path}`,
      {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      const detail = (await response.text())
        .replaceAll(/\s+/gu, ' ')
        .trim()
        .slice(0, 300);
      throw new Error(
        `Twenty REST ${init.method ?? 'GET'} ${path} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    return response.status === 204 ? {} : response.json();
  }

  public async find(
    objectPlural: string,
    filter: string,
  ): Promise<TwentyRecord | undefined> {
    const query = new URLSearchParams({ filter, limit: '1' });
    const payload = await this.request(`${objectPlural}?${query.toString()}`);
    const root = payload as Record<string, unknown>;
    const data = root.data as Record<string, unknown> | unknown[] | undefined;
    const rootRecords = root[objectPlural];
    const nestedRecords =
      data && !Array.isArray(data) ? data[objectPlural] : undefined;
    let records: unknown[] = [];
    if (Array.isArray(data)) records = data;
    else if (Array.isArray(rootRecords)) records = rootRecords as unknown[];
    else if (Array.isArray(nestedRecords)) {
      records = nestedRecords as unknown[];
    }
    const first = records[0];
    return first ? recordSchema.parse(first) : undefined;
  }

  public async create(
    objectPlural: string,
    objectSingular: string,
    data: Record<string, unknown>,
  ): Promise<TwentyRecord> {
    const payload = await this.request(objectPlural, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return this.extractRecord(
      payload,
      objectSingular,
      `create${capitalize(objectSingular)}`,
    );
  }

  public async update(
    objectPlural: string,
    objectSingular: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<TwentyRecord> {
    const payload = await this.request(
      `${objectPlural}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
    return this.extractRecord(
      payload,
      objectSingular,
      `update${capitalize(objectSingular)}`,
    );
  }

  private extractRecord(
    payload: unknown,
    objectSingular: string,
    operation: string,
  ): TwentyRecord {
    const root = payload as Record<string, unknown>;
    const nested = root.data as Record<string, unknown> | undefined;
    const candidate =
      nested?.[operation] ??
      nested?.[objectSingular] ??
      (nested && 'id' in nested ? nested : undefined) ??
      root[operation] ??
      root[objectSingular] ??
      root;
    return recordSchema.parse(candidate);
  }
}
