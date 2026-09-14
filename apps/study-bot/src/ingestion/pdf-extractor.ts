import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { StudyPage } from '../types.js';

export type PdfExtractor = {
  extract(pdf: Uint8Array): Promise<StudyPage[]>;
};

export class PdfJsExtractor implements PdfExtractor {
  public async extract(pdf: Uint8Array): Promise<StudyPage[]> {
    const document = await getDocument({ data: pdf }).promise;
    try {
      const pages: StudyPage[] = [];
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .flatMap((item) => ('str' in item ? [item.str] : []))
          .join(' ')
          .replaceAll(/\s+/g, ' ')
          .trim();
        pages.push({ pageNumber, text });
      }
      return pages;
    } finally {
      await document.destroy();
    }
  }
}

export const hasMeaningfulText = (pages: readonly StudyPage[]): boolean =>
  pages.filter((page) => page.text.replaceAll(/\s+/g, '').length >= 40).length >
    0 && pages.reduce((total, page) => total + page.text.length, 0) >= 400;
