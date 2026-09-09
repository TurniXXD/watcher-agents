import type { Source, WatchItem } from '@watcher/core';
import {
  GdeltNewsSource as SharedGdeltNewsSource,
  type GdeltNewsConfig,
} from '@watcher/sources/news';

export type NewsConfig = {
  symbol: string;
  companyName?: string | null;
  maxItems?: number;
};

export class GdeltNewsSource implements Source<NewsConfig> {
  public readonly id = 'NEWS';
  readonly #source: SharedGdeltNewsSource;
  public readonly capabilities: SharedGdeltNewsSource['capabilities'];

  public constructor(fetcher: typeof fetch = fetch) {
    this.#source = new SharedGdeltNewsSource(fetcher);
    this.capabilities = this.#source.capabilities;
  }

  public async fetch(
    config: NewsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const query = config.companyName?.trim()
      ? `"${config.companyName.trim().replaceAll('"', '')}"`
      : `${symbol} stock`;
    const sharedConfig: GdeltNewsConfig = {
      query: `${query} sourcelang:english`,
      sourceId: this.id,
      sourceName: 'GDELT DOC 2.0',
      entities: [symbol, ...(config.companyName ? [config.companyName] : [])],
      metadata: { symbol, companyName: config.companyName },
      ...(config.maxItems === undefined ? {} : { maxItems: config.maxItems }),
    };
    return this.#source.fetch(sharedConfig, signal);
  }
}
