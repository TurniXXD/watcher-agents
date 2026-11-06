import { describe, expect, it, vi } from 'vitest';

const { destroyLoadingTask } = vi.hoisted(() => ({
  destroyLoadingTask: vi.fn(async () => undefined),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: () => ({
    destroy: destroyLoadingTask,
    promise: Promise.resolve({ numPages: 0 }),
  }),
}));

import {
  hasMeaningfulText,
  PdfJsExtractor,
} from '../ingestion/pdf-extractor.js';

describe('PDF extraction guard', () => {
  it('destroys the PDF loading task after extracting the document', async () => {
    const extractor = new PdfJsExtractor();

    await expect(extractor.extract(new Uint8Array())).resolves.toEqual([]);
    expect(destroyLoadingTask).toHaveBeenCalledOnce();
  });

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
