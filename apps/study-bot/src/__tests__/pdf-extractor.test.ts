import { describe, expect, it } from 'vitest';
import { hasMeaningfulText } from '../ingestion/pdf-extractor.js';

describe('PDF extraction guard', () => {
  it('requires meaningful extracted text and therefore never invents OCR output', () => {
    expect(hasMeaningfulText([{ pageNumber: 1, text: 'scan' }])).toBe(false);
    expect(
      hasMeaningfulText([
        { pageNumber: 1, text: 'A'.repeat(450) },
        { pageNumber: 2, text: 'B'.repeat(50) },
      ]),
    ).toBe(true);
  });
});
