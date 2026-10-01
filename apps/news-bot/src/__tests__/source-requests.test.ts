import type { NewsFeedRecord, NewsTopicRecord } from '@watcher/database';
import {
  builtInNewsSources,
  builtInNewsSourceUrl,
  RssNewsSource,
  type RssNewsConfig,
} from '@watcher/sources/news';
import { describe, expect, it } from 'vitest';
import { buildNewsSourceRequests } from '../watcher.js';

const feeds = builtInNewsSources.map((source, index): NewsFeedRecord => ({
  id: `feed-${index}`,
  builtInKey: source.key,
  scope: source.scope,
  name: source.name,
  url: builtInNewsSourceUrl(source),
  enabled: true,
}));

const topics: NewsTopicRecord[] = [
  { id: 'topic-1', scope: 'GLOBAL', topic: 'energy' },
];

describe('built-in news source requests', () => {
  it('creates only Global RSS requests', () => {
    const requests = buildNewsSourceRequests(
      feeds,
      topics,
      new RssNewsSource(),
    );

    expect(requests).toHaveLength(17);
    expect(requests.every(({ targetKey }) => targetKey === 'GLOBAL')).toBe(
      true,
    );
    expect(requests.every(({ source }) => source.id === 'NEWS_RSS')).toBe(true);
  });

  it('skips retired GDELT built-ins left in the database', () => {
    const requests = buildNewsSourceRequests(
      [
        ...feeds,
        {
          id: 'old-gdelt-feed',
          builtInKey: 'global-gdelt',
          scope: 'GLOBAL',
          name: 'GDELT',
          url: 'https://www.gdeltproject.org/',
          enabled: true,
        },
      ],
      topics,
      new RssNewsSource(),
    );

    expect(requests).toHaveLength(17);
    expect(requests.some(({ target }) => target.includes('gdelt'))).toBe(false);
  });

  it('passes Global category exclusions into RSS requests', () => {
    const requests = buildNewsSourceRequests(
      feeds,
      topics,
      new RssNewsSource(),
      undefined,
      [
        { scope: 'CZECH', category: 'SPORT', enabled: false },
        { scope: 'GLOBAL', category: 'SPORT', enabled: false },
      ],
    );
    const globalRss = requests.find(
      ({ source, targetKey }) =>
        source.id === 'NEWS_RSS' && targetKey === 'GLOBAL',
    );

    expect((globalRss?.config as RssNewsConfig).disabledCategories).toEqual([
      'SPORT',
    ]);
  });
});
