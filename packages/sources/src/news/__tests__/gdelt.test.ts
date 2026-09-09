import { describe, expect, it, vi } from 'vitest';
import { GdeltNewsSource } from '../gdelt.js';

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

describe('shared GdeltNewsSource', () => {
  it('normalizes a publisher query with profile metadata', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({
        articles: [
          {
            url: 'https://www.reuters.com/world/example',
            title: 'Example world report',
            seendate: '20260908T100000Z',
            domain: 'reuters.com',
            language: 'English',
          },
        ],
      });
    });
    const source = new GdeltNewsSource(fetcher);

    await expect(
      source.fetch({
        query: 'domain:reuters.com sourcelang:english',
        sourceName: 'Reuters',
        scope: 'GLOBAL',
        topics: ['geopolitics'],
        metadata: { sourceKey: 'global-reuters' },
        publishers: {
          'reuters.com': {
            sourceKey: 'global-reuters',
            sourceName: 'Reuters',
          },
        },
      }),
    ).resolves.toMatchObject([
      {
        source: 'NEWS_GDELT_GLOBAL',
        title: 'Example world report',
        metadata: {
          sourceKey: 'global-reuters',
          feedName: 'Reuters',
          scope: 'GLOBAL',
          publisherDomain: 'reuters.com',
        },
      },
    ]);
    const requested = new URL(requestUrl(fetcher.mock.calls[0]![0]));
    expect(requested.searchParams.get('query')).toBe(
      'domain:reuters.com sourcelang:english',
    );
  });
});
