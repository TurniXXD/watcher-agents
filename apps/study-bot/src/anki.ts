import type { FlashcardDeck } from './types.js';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const field = (value: string): string =>
  escapeHtml(value).replaceAll(/\r?\n/gu, '<br>').replaceAll('\t', ' ');

const tag = (value: string): string =>
  value
    .trim()
    .replaceAll(/\s+/gu, '_')
    .replaceAll(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 64);

export const renderAnkiTsv = (deck: FlashcardDeck): string =>
  [
    '#separator:Tab',
    '#html:true',
    '#columns:Front\tBack\tTags',
    ...deck.cards.map((card) => {
      const tags = [
        'study-bot',
        `page_${card.sourcePages.start}-${card.sourcePages.end}`,
        ...card.tags.map(tag).filter(Boolean),
      ].join(' ');
      return [
        field(card.front),
        `${field(card.back)}<br><br><i>Source: pp. ${card.sourcePages.start}-${card.sourcePages.end}</i>`,
        tags,
      ].join('\t');
    }),
  ].join('\n');
