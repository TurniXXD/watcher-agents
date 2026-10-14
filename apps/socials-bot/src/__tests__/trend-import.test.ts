import { describe, expect, it } from 'vitest';
import { parseTrendImport } from '../trends/import.js';

describe('manual trend import', () => {
  it('parses CSV and keeps unavailable metrics absent', () => {
    const signals = parseTrendImport(
      'source,title,url,region,views\nTIKTOK,"AI workflow",https://www.tiktok.com/example,US,1200',
      new Date('2026-10-14T05:00:00Z'),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      source: 'TIKTOK',
      region: 'US',
      metrics: { views: 1_200 },
    });
    expect(signals[0]?.metrics.likes).toBeUndefined();
  });

  it('parses JSON exports and rejects unsafe private URLs', () => {
    expect(
      parseTrendImport(
        JSON.stringify([
          {
            source: 'INSTAGRAM',
            title: 'Local AI',
            url: 'https://www.instagram.com/p/example',
            region: 'CZ',
          },
        ]),
      ),
    ).toHaveLength(1);
    expect(() =>
      parseTrendImport(
        JSON.stringify([{ title: 'Unsafe', url: 'http://127.0.0.1/private' }]),
      ),
    ).toThrow();
  });
});
