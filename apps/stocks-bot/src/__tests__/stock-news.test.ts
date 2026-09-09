import type { StoredStockNewsArticle } from '@watcher/database';
import { describe, expect, it } from 'vitest';
import {
  parseStockNewsRequest,
  renderStoredStockNews,
  storedStockNewsJson,
  storedStockNewsJsonFilename,
} from '../stock-news.js';

describe('stored stock news', () => {
  it.each([
    ['24h', 24],
    ['3d', 72],
    ['7d', 168],
    ['30d', 720],
  ])('parses a %s range relative to now', (range, expectedHours) => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    const parsed = parseStockNewsRequest(`mu ${range}`, now);

    expect(parsed).toEqual({
      ticker: 'MU',
      from: new Date(now.getTime() - expectedHours * 60 * 60_000),
      to: now,
      json: false,
    });
  });

  it('parses explicit offset-aware timestamps and rejects reversed ranges', () => {
    expect(
      parseStockNewsRequest(
        'NVDA 2026-09-01T00:00:00+02:00 2026-09-03T12:00:00Z',
      ),
    ).toEqual({
      ticker: 'NVDA',
      from: new Date('2026-08-31T22:00:00.000Z'),
      to: new Date('2026-09-03T12:00:00.000Z'),
      json: false,
    });
    expect(() =>
      parseStockNewsRequest('NVDA 2026-09-04T00:00:00Z 2026-09-03T00:00:00Z'),
    ).toThrow(/must not precede/);
    expect(() => parseStockNewsRequest('NVDA yesterday')).toThrow(/Usage/);
  });

  it('accepts the JSON flag in either position', () => {
    const now = new Date('2026-09-09T12:00:00.000Z');

    expect(parseStockNewsRequest('MU 3d --json', now).json).toBe(true);
    expect(parseStockNewsRequest('--json MU 3d', now).json).toBe(true);
    expect(() => parseStockNewsRequest('MU 3d --csv', now)).toThrow(/Usage/);
  });

  it('renders every stored field and a clear empty state', () => {
    const request = {
      ticker: 'MU',
      from: new Date('2026-09-08T00:00:00.000Z'),
      to: new Date('2026-09-09T00:00:00.000Z'),
      json: false,
    };
    const article: StoredStockNewsArticle = {
      publishedAt: new Date('2026-09-08T12:30:00.000Z'),
      tickers: ['MU'],
      headline: 'Micron & partner expand memory production',
      summary: 'The expansion adds advanced memory capacity.',
      description: 'Full stored article description with all available facts.',
      source: 'Reuters',
      url: 'https://example.com/micron?story=1&source=news',
      sentiment: 'positive',
      importance: 8,
      analysis: {
        title: 'Micron expands memory production',
        summary: 'The expansion adds advanced memory capacity.',
        importance: 8,
        sentiment: 'positive',
        eventType: 'CAPACITY_EXPANSION',
        positives: ['More capacity'],
        negatives: [],
        risks: ['Execution'],
        catalysts: ['Ramp'],
        confidence: 0.9,
      },
    };

    const rendered = renderStoredStockNews(request, [article]);

    expect(rendered).toContain('2026-09-08 12:30:00Z');
    expect(rendered).toContain('<b>MU</b>');
    expect(rendered).toContain('Micron &amp; partner');
    expect(rendered).toContain('Source: Reuters');
    expect(rendered).toContain('https://example.com/micron');
    expect(rendered).toContain('Sentiment: positive · Importance: 8/10');
    expect(renderStoredStockNews(request, [])).toContain(
      'No matching saved news was published',
    );

    const exported: unknown = JSON.parse(
      storedStockNewsJson(request, [article]),
    );
    expect(exported).toMatchObject({
      ticker: 'MU',
      count: 1,
      articles: [
        {
          publishedAt: '2026-09-08T12:30:00.000Z',
          description:
            'Full stored article description with all available facts.',
          analysis: {
            positives: ['More capacity'],
            risks: ['Execution'],
          },
        },
      ],
    });
    expect(storedStockNewsJsonFilename(request)).toBe(
      'stock-news-MU-2026-09-08-2026-09-09.json',
    );
    const emptyExport: unknown = JSON.parse(storedStockNewsJson(request, []));
    expect(emptyExport).toMatchObject({
      count: 0,
      message: 'No matching saved stock news was published in this range.',
      articles: [],
    });
  });
});
