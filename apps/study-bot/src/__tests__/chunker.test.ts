import { describe, expect, it } from 'vitest';
import { chunkPages } from '../ingestion/chunker.js';

describe('study PDF chunking', () => {
  it('preserves source page ranges while splitting readable page text', () => {
    const chunks = chunkPages(
      'document-1',
      [
        {
          pageNumber: 1,
          text: 'A cell membrane separates a cell. It has a bilayer.',
        },
        {
          pageNumber: 2,
          text: 'Membrane proteins transport selected substances.',
        },
      ],
      70,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      documentId: 'document-1',
      pageRange: { start: 1, end: 1 },
    });
    expect(chunks[1]).toMatchObject({ pageRange: { start: 2, end: 2 } });
  });
});
