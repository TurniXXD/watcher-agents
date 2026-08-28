import type {
  PipelineResult,
  PublicationAnalysis,
  StockAnalysis,
} from '@watcher/core';
import type { Api } from 'grammy';

const LIMIT = 4000;

const metadataText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;

export const splitTelegramMessage = (text: string, limit = LIMIT): string[] => {
  if (text.length <= limit) return [text];
  const sections = text.split('\n\n');
  const messages: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current) messages.push(current);
    current = '';
  };

  for (const section of sections) {
    if (section.length > limit) {
      flush();
      for (let index = 0; index < section.length; index += limit) {
        messages.push(section.slice(index, index + limit));
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length > limit) flush();
    current = current ? `${current}\n\n${section}` : section;
  }

  flush();
  return messages;
};

export const sendSplitMessage = async (
  api: Api,
  chatId: bigint,
  text: string,
): Promise<void> => {
  for (const part of splitTelegramMessage(text))
    await api.sendMessage(chatId.toString(), part);
};

const failureSection = (result: PipelineResult): string =>
  result.sourceFailures.length === 0
    ? ''
    : `\n\n⚠️ Source errors:\n${result.sourceFailures
        .map(
          (failure) =>
            `• ${failure.target} ${failure.source}: ${failure.message}`,
        )
        .join('\n')}`;

export const renderStockDigest = (result: PipelineResult): string => {
  const sections = result.analyses
    .filter(({ outcome }) => outcome.status === 'SUCCESS')
    .map(({ item, outcome }) => {
      const analysis =
        outcome.status === 'SUCCESS'
          ? (outcome.result as StockAnalysis)
          : undefined;
      if (!analysis) return '';
      const icon =
        analysis.sentiment === 'positive'
          ? '🟢'
          : analysis.sentiment === 'negative'
            ? '🔴'
            : '⚪';
      return [
        metadataText(item.metadata.target, item.title),
        `${icon} ${analysis.sentiment} — importance ${analysis.importance}/10`,
        analysis.summary,
        analysis.risks.length ? `Risks: ${analysis.risks.join('; ')}` : '',
        `Source: ${item.source}\n${item.url}`,
      ]
        .filter(Boolean)
        .join('\n');
    });

  return `📈 STOCK WATCHER\n\n${sections.join('\n\n')}${failureSection(result)}`.trim();
};

export const renderPublicationDigest = (result: PipelineResult): string => {
  const sections = result.analyses
    .filter(({ outcome }) => outcome.status === 'SUCCESS')
    .map(({ item, outcome }, index) => {
      const analysis =
        outcome.status === 'SUCCESS'
          ? (outcome.result as PublicationAnalysis)
          : undefined;
      if (!analysis) return '';
      return [
        `Topic: ${metadataText(item.metadata.target)}`,
        `${index + 1}. ${analysis.title}`,
        `Relevance: ${analysis.relevance}/10 · Importance: ${analysis.importance}/10`,
        analysis.summary,
        analysis.keyFindings.length
          ? `Key findings: ${analysis.keyFindings.join('; ')}`
          : '',
        `${item.source}: ${item.url}`,
      ]
        .filter(Boolean)
        .join('\n');
    });

  return `🧬 PUBLICATIONS WATCHER\n\n${sections.join('\n\n')}${failureSection(result)}`.trim();
};
