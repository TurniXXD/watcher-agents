import { describe, expect, it } from 'vitest';
import { renderAnkiTsv } from '../anki.js';

describe('Anki flashcard export', () => {
  it('emits an Anki-compatible UTF-8 TSV with page tags and safe HTML', () => {
    const exported = renderAnkiTsv({
      title: 'Cell biology',
      cards: [
        {
          front: 'What is a <membrane>?',
          back: 'A selective barrier.\nIt separates the cell.',
          sourcePages: { start: 12, end: 15 },
          tags: ['cell biology', 'definition'],
        },
        {
          front: 'What does a bilayer contain?',
          back: 'Phospholipids.',
          sourcePages: { start: 15, end: 15 },
          tags: [],
        },
        {
          front: 'Card 3',
          back: 'Back 3',
          sourcePages: { start: 15, end: 15 },
          tags: [],
        },
        {
          front: 'Card 4',
          back: 'Back 4',
          sourcePages: { start: 15, end: 15 },
          tags: [],
        },
        {
          front: 'Card 5',
          back: 'Back 5',
          sourcePages: { start: 15, end: 15 },
          tags: [],
        },
      ],
    });

    expect(exported).toContain('#separator:Tab');
    expect(exported).toContain('#columns:Front\tBack\tTags');
    expect(exported).toContain('What is a &lt;membrane&gt;?');
    expect(exported).toContain('It separates the cell.<br>');
    expect(exported).toContain('study-bot page_12-15 cell_biology definition');
  });
});
