import type { StoredStockNewsArticle } from '@watcher/database';
import { htmlText, sourceLink, stockSymbolSchema } from '@watcher/telegram';
import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
const durationPattern = /^(\d+)([hd])$/iu;
const usage =
  'Usage: /news SYMBOL 24h [--json]\nOr: /news SYMBOL 2026-09-01T00:00:00Z 2026-09-05T23:59:59Z [--json]';

export type StockNewsRequest = {
  ticker: string;
  from: Date;
  to: Date;
  json: boolean;
};

export const parseStockNewsRequest = (
  rawInput: string,
  now = new Date(),
): StockNewsRequest => {
  const rawParts = rawInput.trim().split(/\s+/u).filter(Boolean);
  const jsonFlags = rawParts.filter((part) => part === '--json');
  const unknownFlags = rawParts.filter(
    (part) => part.startsWith('--') && part !== '--json',
  );
  if (jsonFlags.length > 1 || unknownFlags.length > 0) throw new Error(usage);
  const parts = rawParts.filter((part) => part !== '--json');
  const json = jsonFlags.length === 1;
  if (parts.length === 2) {
    const parsedTicker = stockSymbolSchema.safeParse(parts[0]);
    const duration = parts[1]?.match(durationPattern);
    if (!parsedTicker.success || !duration) throw new Error(usage);
    const amount = Number(duration[1]);
    const unit = duration[2]?.toLowerCase();
    const hours = unit === 'd' ? amount * 24 : amount;
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > 365 * 24) {
      throw new Error('The news range must be between 1 hour and 365 days.');
    }
    return {
      ticker: parsedTicker.data,
      from: new Date(now.getTime() - hours * 60 * 60_000),
      to: new Date(now),
      json,
    };
  }
  if (parts.length === 3) {
    const parsedTicker = stockSymbolSchema.safeParse(parts[0]);
    const parsedFrom = timestampSchema.safeParse(parts[1]);
    const parsedTo = timestampSchema.safeParse(parts[2]);
    if (!parsedTicker.success || !parsedFrom.success || !parsedTo.success) {
      throw new Error(usage);
    }
    const from = new Date(parsedFrom.data);
    const to = new Date(parsedTo.data);
    if (to < from)
      throw new Error('The end timestamp must not precede the start.');
    return { ticker: parsedTicker.data, from, to, json };
  }
  throw new Error(usage);
};

const displayTimestamp = (value: Date): string =>
  value.toISOString().replace('T', ' ').replace('.000Z', 'Z');

export const renderStoredStockNews = (
  request: StockNewsRequest,
  articles: readonly StoredStockNewsArticle[],
): string => {
  const range = `${displayTimestamp(request.from)} – ${displayTimestamp(request.to)}`;
  if (articles.length === 0) {
    return `📰 <b>STORED STOCK NEWS · ${htmlText(request.ticker, 20)}</b>\n\nNo matching saved news was published in ${htmlText(range, 100)}.`;
  }
  const entries = articles.map((article) => {
    const metrics = [
      article.sentiment ? `Sentiment: ${article.sentiment}` : '',
      article.importance === undefined
        ? ''
        : `Importance: ${article.importance}/10`,
    ]
      .filter(Boolean)
      .join(' · ');
    return [
      `🕒 <b>${htmlText(displayTimestamp(article.publishedAt), 50)}</b>`,
      `🏷 <b>${htmlText(article.tickers.join(', '), 100)}</b>`,
      `<b>${htmlText(article.headline, 500)}</b>`,
      htmlText(article.summary, 900),
      `Source: ${htmlText(article.source, 150)}`,
      `URL: ${sourceLink(article.url, article.url, 300)}`,
      metrics ? htmlText(metrics, 150) : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    `📰 <b>STORED STOCK NEWS · ${htmlText(request.ticker, 20)}</b>`,
    `<b>Published:</b> ${htmlText(range, 100)}`,
    `<b>Stories:</b> ${articles.length}`,
    entries.join('\n\n──────────\n\n'),
  ].join('\n\n');
};

export const storedStockNewsJson = (
  request: StockNewsRequest,
  articles: readonly StoredStockNewsArticle[],
): string =>
  JSON.stringify(
    {
      ticker: request.ticker,
      publicationRange: {
        from: request.from.toISOString(),
        to: request.to.toISOString(),
      },
      count: articles.length,
      ...(articles.length === 0
        ? {
            message:
              'No matching saved stock news was published in this range.',
          }
        : {}),
      articles: articles.map((article) => ({
        ...article,
        publishedAt: article.publishedAt.toISOString(),
      })),
    },
    null,
    2,
  );

export const storedStockNewsJsonFilename = (
  request: StockNewsRequest,
): string =>
  `stock-news-${request.ticker}-${request.from.toISOString().slice(0, 10)}-${request.to.toISOString().slice(0, 10)}.json`;

export { usage as stockNewsUsage };
