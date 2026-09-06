import { createHash } from 'node:crypto';
import { parseDate, type Source, type WatchItem } from '@watcher/core';
import { fetchText, htmlAttribute, stripHtml } from './utils/http.js';

export type FinvizConfig = { symbol: string; maxItems?: number };

const finvizHeaders = {
  accept: 'text/html,application/xhtml+xml',
  'user-agent':
    'Mozilla/5.0 (compatible; Watcher/1.0; +https://github.com/TurniXXD/watcher-agents)',
};

const finvizDate = (value: string): Date | undefined => {
  const normalized = value.replace(/'([0-9]{2})$/, '20$1');
  return parseDate(`${normalized} UTC`);
};

export class FinvizInsiderSource implements Source<FinvizConfig> {
  public readonly id = 'FINVIZ';
  public readonly capabilities = {
    sourceName: 'FINVIZ Insider Trading',
    sourceType: 'OTHER' as const,
    minimumIntervalMs: 5 * 60_000,
    preferredIntervalMs: 30 * 60_000,
    maximumIntervalMs: 6 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 65,
  };

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: FinvizConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const pageUrl = `https://finviz.com/quote.ashx?t=${encodeURIComponent(symbol)}&p=d`;
    const html = await fetchText(this.fetcher, pageUrl, finvizHeaders, signal);
    const rows = [
      ...html.matchAll(
        /<tr\b[^>]*class=["'][^"']*\bfv-insider-row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi,
      ),
    ];
    const maxItems = Math.max(0, Math.min(config.maxItems ?? 5, 20));

    return rows.slice(0, maxItems).flatMap((row): WatchItem[] => {
      const cells = [
        ...(row[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
      ].map((cell) => cell[1] ?? '');
      if (cells.length < 9) return [];

      const [ownerCell, relationshipCell, dateCell, transactionCell] = cells;
      const owner = stripHtml(ownerCell ?? '');
      const relationship = stripHtml(relationshipCell ?? '');
      const transactionDate = stripHtml(dateCell ?? '');
      const transaction = stripHtml(transactionCell ?? '');
      const cost = stripHtml(cells[4] ?? '');
      const shares = stripHtml(cells[5] ?? '');
      const value = stripHtml(cells[6] ?? '');
      const sharesTotal = stripHtml(cells[7] ?? '');
      const filingCell = cells[8] ?? '';
      const filingHref = htmlAttribute(filingCell, 'href');
      if (!owner || !transaction || !filingHref) return [];

      const filingUrl = new URL(filingHref, pageUrl);
      if (!['http:', 'https:'].includes(filingUrl.protocol)) return [];
      if (filingUrl.hostname === 'www.sec.gov') filingUrl.protocol = 'https:';
      const content = [
        `Ticker: ${symbol}`,
        `Owner: ${owner}`,
        `Relationship: ${relationship || 'not stated'}`,
        `Transaction date: ${transactionDate || 'not stated'}`,
        `Transaction: ${transaction}`,
        `Price per share: ${cost || 'not stated'}`,
        `Shares: ${shares || 'not stated'}`,
        `Transaction value: ${value || 'not stated'}`,
        `Shares held after transaction: ${sharesTotal || 'not stated'}`,
        `SEC filing time shown by FINVIZ: ${stripHtml(filingCell) || 'not stated'}`,
      ].join('\n');
      const externalId = createHash('sha256')
        .update(`${filingUrl.toString()}\n${content}`)
        .digest('hex');

      return [
        {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: `${symbol} insider ${transaction}: ${owner}`,
          url: filingUrl.toString(),
          publishedAt: finvizDate(transactionDate),
          content,
          sourceType: 'OTHER',
          primarySource: false,
          category: 'INSIDER_TRANSACTION',
          normalizedFacts: {
            owner,
            relationship,
            transaction,
            transactionDate,
            cost,
            shares,
            value,
            sharesTotal,
          },
          entities: [symbol, owner],
          reliability: 0.8,
          metadata: {
            symbol,
            owner,
            relationship,
            transaction,
            cost,
            shares,
            value,
            sharesTotal,
            finvizUrl: pageUrl,
          },
        },
      ];
    });
  }
}
