import { describe, expect, it, vi } from 'vitest';
import type { WatcherLogger } from '@watcher/core';
import type { OsintStore } from '@watcher/database';
import type { Collector } from '../collectors/types.js';
import { OsintService } from '../service.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as WatcherLogger;

describe('OSINT run orchestration', () => {
  it('preserves successful evidence when an independent collector fails', async () => {
    const ingest = vi.fn(async () => ({ id: 'ev', isNew: true }));
    const finishRun = vi.fn(async () => undefined);
    const store = {
      getInvestigation: vi.fn(async () => ({
        id: 'inv',
        selectors: [
          {
            id: 'sel',
            type: 'ICO',
            value: '25301632',
            original: 'IČO 25301632',
            depth: 0,
          },
        ],
      })),
      beginRun: vi.fn(async () => true),
      ingest,
      recordCollectorRun: vi.fn(async () => undefined),
      finishRun,
    } as unknown as OsintStore;
    const entity = {
      kind: 'ORGANIZATION' as const,
      key: 'ico:25301632',
      label: 'Company',
    };
    const good: Collector = {
      id: 'GOOD',
      supports: ['ICO'],
      priority: 10,
      collect: vi.fn(async () => [
        {
          sourceKey: 'good:1',
          sourceUrl: 'https://ares.gov.cz/example',
          excerpt: 'Company',
          data: { ico: '25301632' },
          findings: [{ entity, predicate: 'ICO', value: '25301632' }],
          links: [],
        },
      ]),
    };
    const bad: Collector = {
      id: 'BAD',
      supports: ['ICO'],
      priority: 9,
      collect: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const result = await new OsintService(store, [good, bad], logger).run(
      'user',
      'inv',
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.newEvidence).toBe(1);
    expect(result.failures).toEqual(['BAD — provider unavailable']);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(finishRun).toHaveBeenCalledWith(
      'inv',
      'PARTIAL',
      'BAD — provider unavailable',
    );
  });

  it('rejects overlapping runs without fetching again', async () => {
    const store = {
      getInvestigation: vi.fn(async () => ({ id: 'inv', selectors: [] })),
      beginRun: vi.fn(async () => false),
    } as unknown as OsintStore;
    const result = await new OsintService(store, [], logger).run('user', 'inv');
    expect(result.status).toBe('BUSY');
  });
});
