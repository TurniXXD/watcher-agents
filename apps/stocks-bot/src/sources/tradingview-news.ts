import { createHash } from 'node:crypto';
import {
  isRecord,
  parseDate,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';
import {
  decodeHtmlEntities,
  fetchText,
  normalizeWhitespace,
  stripHtml,
} from './utils/http.js';

export type TradingViewNewsConfig = {
  symbol: string;
  companyName?: string | null;
  exchange?: string | null;
  maxItems?: number;
};

const providerSchema = z.union([
  z.string().min(1),
  z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      logo_id: z.string().optional(),
    })
    .passthrough(),
]);

const relatedSymbolSchema = z
  .object({
    symbol: z.string().min(1),
    logoid: z.string().optional(),
  })
  .passthrough();

const headlineSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    published: z.number().optional(),
    link: z.url().optional(),
    storyPath: z.string().optional(),
    source: z.string().optional(),
    urgency: z.number().optional(),
    permission: z.string().optional(),
    provider: providerSchema.optional(),
    relatedSymbols: z.array(relatedSymbolSchema).default([]),
  })
  .passthrough();

const responseSchema = z.union([
  z.object({ items: z.array(headlineSchema).default([]) }).passthrough(),
  z.array(headlineSchema),
]);

const headers = {
  accept: 'application/json,text/plain,*/*',
  origin: 'https://www.tradingview.com',
  referer: 'https://www.tradingview.com/',
  'user-agent':
    'Mozilla/5.0 (compatible; Watcher/1.0; +https://github.com/TurniXXD/watcher-agents)',
};

const articleHeaders = {
  accept: 'text/html,application/xhtml+xml',
  referer: 'https://www.tradingview.com/',
  'user-agent': headers['user-agent'],
};

const tradingViewExchange = (exchange: string | null | undefined): string => {
  const normalized = exchange?.trim().toUpperCase() ?? '';
  if (normalized.includes('NASDAQ')) return 'NASDAQ';
  if (normalized === 'NYSE' || normalized.includes('NEW YORK STOCK EXCHANGE'))
    return 'NYSE';
  if (
    normalized.includes('NYSE AMERICAN') ||
    normalized.includes('NYSE MKT') ||
    normalized.includes('AMEX')
  )
    return 'AMEX';
  return 'NASDAQ';
};

const providerName = (provider: z.infer<typeof providerSchema> | undefined) => {
  if (typeof provider === 'string') return provider;
  return provider?.name ?? provider?.id;
};

type ArticleDetails = {
  body?: string;
  publishedAt?: Date;
  provider?: string;
};

const jsonString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const jsonLdTypeMatches = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return ['ARTICLE', 'NEWSARTICLE'].includes(value.toUpperCase());
  }
  return Array.isArray(value) && value.some(jsonLdTypeMatches);
};

const findArticleJson = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findArticleJson(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (jsonLdTypeMatches(value['@type'])) return value;
  const graph = value['@graph'];
  return Array.isArray(graph) ? findArticleJson(graph) : undefined;
};

const publisherName = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return jsonString(value.name);
  return undefined;
};

const articleDetailsFromJsonLd = (html: string): ArticleDetails | undefined => {
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = decodeHtmlEntities(match[1] ?? '').trim();
    if (!raw) continue;
    try {
      const article = findArticleJson(JSON.parse(raw));
      if (!article) continue;
      const body =
        jsonString(article.articleBody) ?? jsonString(article.description);
      const publishedAt = parseDate(
        jsonString(article.datePublished) ?? jsonString(article.dateModified),
      );
      const provider = publisherName(article.publisher);
      return {
        ...(body ? { body: normalizeWhitespace(body).slice(0, 3_500) } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(provider ? { provider } : {}),
      };
    } catch {
      continue;
    }
  }
  return undefined;
};

const articleDetailsFromHtml = (html: string): ArticleDetails => {
  const fromJsonLd = articleDetailsFromJsonLd(html);
  if (fromJsonLd?.body) return fromJsonLd;
  return { body: stripHtml(html).slice(0, 3_500) };
};

export class TradingViewNewsSource implements Source<TradingViewNewsConfig> {
  public readonly id = 'TRADINGVIEW_NEWS';
  public readonly capabilities = {
    sourceName: 'TradingView News',
    sourceType: 'NEWS' as const,
    minimumIntervalMs: 5 * 60_000,
    preferredIntervalMs: 30 * 60_000,
    maximumIntervalMs: 6 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 68,
  };

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: TradingViewNewsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const exchange = tradingViewExchange(config.exchange);
    const tradingViewSymbol = `${exchange}:${symbol}`;
    const maxItems = Math.max(0, Math.min(config.maxItems ?? 5, 20));
    const endpoint = new URL(
      'https://news-headlines.tradingview.com/v2/view/headlines/symbol',
    );
    endpoint.searchParams.set('symbol', tradingViewSymbol);
    endpoint.searchParams.set('client', 'web');
    endpoint.searchParams.set('streaming', 'false');
    endpoint.searchParams.set('lang', 'en');
    endpoint.searchParams.set('limit', String(maxItems));

    const parsed = responseSchema.parse(
      JSON.parse(
        await fetchText(this.fetcher, endpoint.toString(), headers, signal),
      ),
    );
    const headlines = Array.isArray(parsed) ? parsed : parsed.items;

    const detailResults = await Promise.all(
      headlines.slice(0, maxItems).map(async (headline) => {
        const articleUrl = headline.storyPath
          ? new URL(headline.storyPath, 'https://www.tradingview.com')
          : headline.link
            ? new URL(headline.link)
            : undefined;
        if (!articleUrl || articleUrl.hostname !== 'www.tradingview.com') {
          return { headline, articleUrl, details: undefined };
        }
        try {
          return {
            headline,
            articleUrl,
            details: articleDetailsFromHtml(
              await fetchText(
                this.fetcher,
                articleUrl.toString(),
                articleHeaders,
                signal,
              ),
            ),
          };
        } catch {
          return { headline, articleUrl, details: undefined };
        }
      }),
    );

    return detailResults.map(({ headline, articleUrl, details }) => {
      const publishedAt = details?.publishedAt ?? parseDate(headline.published);
      const provider =
        details?.provider ??
        providerName(headline.provider) ??
        headline.source ??
        'TradingView';
      const relatedSymbols = headline.relatedSymbols.map(
        (related) => related.symbol,
      );
      const url =
        articleUrl?.toString() ??
        headline.link ??
        `https://www.tradingview.com/symbols/${exchange}-${symbol}/news/`;
      const content = [
        `Ticker: ${symbol}`,
        config.companyName ? `Company: ${config.companyName}` : '',
        `TradingView symbol: ${tradingViewSymbol}`,
        `Provider: ${provider}`,
        publishedAt ? `Published: ${publishedAt.toISOString()}` : '',
        headline.permission ? `Permission: ${headline.permission}` : '',
        headline.urgency === undefined ? '' : `Urgency: ${headline.urgency}`,
        `Headline: ${headline.title}`,
        details?.body ? `Article text: ${details.body}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const externalId =
        headline.id || createHash('sha256').update(url).digest('hex');

      return {
        id: `${this.id}:${createHash('sha256').update(externalId).digest('hex')}`,
        source: this.id,
        externalId,
        title: `${symbol} TradingView: ${headline.title}`,
        url,
        ...(publishedAt ? { publishedAt, eventAt: publishedAt } : {}),
        content,
        sourceType: 'NEWS' as const,
        primarySource: false,
        category: 'NEWS',
        normalizedFacts: {
          provider,
          tradingViewSymbol,
          relatedSymbols,
          permission: headline.permission,
          urgency: headline.urgency,
        },
        entities: [
          symbol,
          ...(config.companyName ? [config.companyName] : []),
          ...relatedSymbols,
        ],
        reliability: 0.65,
        metadata: {
          symbol,
          companyName: config.companyName,
          exchange,
          tradingViewSymbol,
          provider,
          headlineId: headline.id,
          relatedSymbols,
          originalLink: headline.link,
        },
      };
    });
  }
}
