import type { WatchItem } from '@watcher/core';
import { describe, expect, it } from 'vitest';
import { fairlyOrderPublicationItems } from '../utils/fair-items.js';

const item = (
  target: string,
  id: string,
  publishedAt = new Date('2026-09-10T00:00:00Z'),
): WatchItem => ({
  id,
  source: 'PUBMED',
  externalId: id,
  title: id,
  url: `https://example.com/${id}`,
  publishedAt,
  content: id,
  metadata: { target },
});

describe('fair publication item ordering', () => {
  it('gives each topic one candidate before taking a second', () => {
    const ordered = fairlyOrderPublicationItems(
      [
        item('3D bioprinting', '3d-1'),
        item('3D bioprinting', '3d-2'),
        item('aging', 'aging-1'),
        item('aging', 'aging-2'),
        item('genomics', 'genomics-1'),
        item('genomics', 'genomics-2'),
      ],
      'run-1',
    );

    expect(
      new Set(ordered.slice(0, 3).map((entry) => entry.metadata.target)),
    ).toEqual(new Set(['3D bioprinting', 'aging', 'genomics']));
  });

  it('prefers the newest item within each topic', () => {
    const ordered = fairlyOrderPublicationItems(
      [
        item('aging', 'old', new Date('2026-09-01T00:00:00Z')),
        item('aging', 'new', new Date('2026-09-10T00:00:00Z')),
      ],
      'run-2',
    );

    expect(ordered.map((entry) => entry.externalId)).toEqual(['new', 'old']);
  });
});
