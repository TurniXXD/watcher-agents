import type { StudyChunk, StudyPage } from '../types.js';

const sentences = (text: string): string[] =>
  text
    .match(/[^.!?]+(?:[.!?]+|$)/g)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [];

export const chunkPages = (
  documentId: string,
  pages: readonly StudyPage[],
  maximumCharacters = 10_000,
): StudyChunk[] => {
  const chunks: StudyChunk[] = [];
  let text = '';
  let start = 1;
  let end = 1;
  const push = (): void => {
    const sourceText = text.trim();
    if (sourceText)
      chunks.push({ documentId, pageRange: { start, end }, sourceText });
    text = '';
  };
  for (const page of pages) {
    const pageText = page.text.trim();
    if (!pageText) continue;
    const units = sentences(pageText);
    for (const unit of units.length ? units : [pageText]) {
      if (text && `${text} ${unit}`.length > maximumCharacters) push();
      if (!text) start = page.pageNumber;
      text = `${text} ${unit}`.trim();
      end = page.pageNumber;
    }
  }
  push();
  return chunks;
};
