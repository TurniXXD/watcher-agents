import { describe, expect, it } from 'vitest';
import { builtInNewsSources, builtInNewsSourceUrl } from '../catalog.js';

const czechNames = [
  'iROZHLAS',
  'ČT24',
  'ČTK',
  'Seznam Zprávy',
  'Hospodářské noviny',
  'Deník N',
  'Respekt',
  'Aktuálně.cz',
  'Novinky.cz',
  'ČNB',
  'ČSÚ',
  'Vláda ČR',
];

const globalNames = [
  'Reuters',
  'Associated Press (AP)',
  'BBC News',
  'The Guardian',
  'Al Jazeera English',
  'NPR',
  'Financial Times',
  'Bloomberg',
  'The Economist',
  'Politico Europe',
  'Euractiv',
  'Nature News',
  'Science',
  'MIT Technology Review',
  'Ars Technica',
  'WHO',
  'European Commission',
  'ECB',
  'NASA',
  'ESA',
  'IEA',
  'GDELT',
];

describe('built-in news source catalog', () => {
  it('contains every requested Czech and Global source exactly once', () => {
    expect(
      builtInNewsSources
        .filter(({ scope }) => scope === 'CZECH')
        .map(({ name }) => name),
    ).toEqual(czechNames);
    expect(
      builtInNewsSources
        .filter(({ scope }) => scope === 'GLOBAL')
        .map(({ name }) => name),
    ).toEqual(globalNames);
    expect(new Set(builtInNewsSources.map(({ key }) => key)).size).toBe(
      builtInNewsSources.length,
    );
  });

  it('uses public HTTPS URLs for every persisted source', () => {
    for (const source of builtInNewsSources) {
      expect(new URL(builtInNewsSourceUrl(source)).protocol).toBe('https:');
      if (source.adapter === 'RSS') {
        expect(new URL(source.feedUrl).protocol).toBe('https:');
      } else {
        expect(source.query.trim()).not.toBe('');
      }
    }
  });

  it('uses RSS for 29 sources and bounded GDELT discovery for five', () => {
    expect(
      builtInNewsSources.filter(({ adapter }) => adapter === 'RSS'),
    ).toHaveLength(29);
    expect(
      builtInNewsSources.filter(({ adapter }) => adapter === 'GDELT'),
    ).toHaveLength(5);
  });
});
