import { describe, expect, it } from 'vitest';
import {
  chunkAnalysisPrompt,
  flashcardPrompt,
  lecturePrompt,
} from '../llm/prompts.js';

describe('study prompts', () => {
  it('makes source-only constraints and page ranges explicit', () => {
    const prompt = chunkAnalysisPrompt({
      documentId: 'doc',
      pageRange: { start: 12, end: 15 },
      sourceText: 'Plasma membrane content.',
    });

    expect(prompt).toContain('Use only information supported');
    expect(prompt).toContain('pages 12-15');
    expect(prompt).toContain('Plasma membrane content.');
  });

  it('asks for a TTS-safe lecture rather than a page-by-page reading', () => {
    const prompt = lecturePrompt({ title: 'Membranes', sections: [] }, []);

    expect(prompt).toContain('natural spoken university lecture');
    expect(prompt).toContain('Do not mention page numbers aloud');
  });

  it('requires flashcards to remain source-grounded and page-referenced', () => {
    const prompt = flashcardPrompt([]);

    expect(prompt).toContain('based only on these facts');
    expect(prompt).toContain('sourcePages');
    expect(prompt).toContain('Do not add outside knowledge');
  });
});
