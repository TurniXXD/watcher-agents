import type { NewsFeedRecord, NewsTopicRecord } from '@watcher/database';
import {
  builtInNewsSources,
  builtInNewsSourceUrl,
  GdeltNewsSource,
  type GdeltNewsConfig,
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
  it('creates one request per RSS source and one combined GDELT request', () => {
    const requests = buildNewsSourceRequests(
      feeds,
      topics,
      new RssNewsSource(),
      new GdeltNewsSource(),
    );
    const gdelt = requests.filter(({ source }) => source.id === 'NEWS_GDELT');

    expect(requests).toHaveLength(30);
    expect(gdelt).toHaveLength(1);
    expect(gdelt[0]).toMatchObject({
      target: 'GLOBAL:built-in-gdelt',
      targetKey: 'GLOBAL',
    });
    const config = gdelt[0]!.config as GdeltNewsConfig;
    expect(config.query).toContain('domain:reuters.com');
    expect(config.query).toContain('domain:apnews.com');
    expect(config.query).toContain('sourcelang:english');
    expect(config.query).toBe(
      '(domain:reuters.com OR domain:apnews.com OR domain:euractiv.com OR domain:iea.org OR conflict OR economy OR politics OR climate OR health OR science OR technology) sourcelang:english',
    );
    expect(config.query).not.toContain('((');
    expect(config.metadata?.sourceKeys).toHaveLength(5);
    expect(config.topics).toEqual(['energy']);
  });

  it('omits disabled sources from the combined GDELT request', () => {
    const withoutReuters = feeds.map((feed) =>
      feed.builtInKey === 'global-reuters' ? { ...feed, enabled: false } : feed,
    );
    const requests = buildNewsSourceRequests(
      withoutReuters,
      topics,
      new RssNewsSource(),
      new GdeltNewsSource(),
    );
    const gdelt = requests.find(({ source }) => source.id === 'NEWS_GDELT');
    const config = gdelt!.config as GdeltNewsConfig;

    expect(config.query).not.toContain('domain:reuters.com');
    expect(config.metadata?.sourceKeys).toHaveLength(4);
  });

  it('passes profile category exclusions into RSS requests', () => {
    const requests = buildNewsSourceRequests(
      feeds,
      topics,
      new RssNewsSource(),
      new GdeltNewsSource(),
      undefined,
      [
        { scope: 'CZECH', category: 'SPORT', enabled: false },
        { scope: 'GLOBAL', category: 'SPORT', enabled: false },
      ],
    );
    const czechRss = requests.find(
      ({ source, targetKey }) =>
        source.id === 'NEWS_RSS' && targetKey === 'CZECH',
    );
    const globalRss = requests.find(
      ({ source, targetKey }) =>
        source.id === 'NEWS_RSS' && targetKey === 'GLOBAL',
    );

    expect((czechRss?.config as RssNewsConfig).disabledCategories).toEqual([
      'SPORT',
    ]);
    expect((globalRss?.config as RssNewsConfig).disabledCategories).toEqual([
      'SPORT',
    ]);
  });
});
