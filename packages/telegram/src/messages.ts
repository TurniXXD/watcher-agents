import type {
  PipelineResult,
  PublicationAnalysis,
  RunProgress,
  StockAnalysis,
} from '@watcher/core';
import type { Api } from 'grammy';

const LIMIT = 4000;
const MAX_TITLE = 500;
const MAX_SUMMARY = 1500;
const MAX_LIST_ITEM = 400;
const MAX_LIST_ITEMS = 6;

const metadataText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const htmlText = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  let output = '';
  let truncated = false;
  for (const character of normalized) {
    const escaped = escapeHtml(character);
    if (output.length + escaped.length > limit - 1) {
      truncated = true;
      break;
    }
    output += escaped;
  }
  return truncated ? `${output}…` : output;
};

const bulletList = (values: string[]): string =>
  values
    .slice(0, MAX_LIST_ITEMS)
    .map((value) => `• ${htmlText(value, MAX_LIST_ITEM)}`)
    .join('\n');

const sourceLink = (source: string, rawUrl: string): string => {
  const url = new URL(rawUrl).toString();
  const label = htmlText(source, 100);
  return url.length <= 2048
    ? `<a href="${escapeHtml(url)}">${label}</a>`
    : label;
};

export const formatRunDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const runDurationLine = (result: PipelineResult): string =>
  result.durationMs === undefined
    ? ''
    : `⏱ <b>Run time:</b> ${formatRunDuration(result.durationMs)}`;

export const renderRunProgress = (progress: RunProgress): string => {
  const percent = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;

  return [
    '⏳ Processing request...',
    `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`,
    `Current step: ${progress.step}`,
  ].join('\n');
};

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
    await api.sendMessage(chatId.toString(), part, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
};

const failureSection = (result: PipelineResult): string =>
  result.sourceFailures.length === 0
    ? ''
    : `\n\n⚠️ <b>Source errors</b>\n${result.sourceFailures
        .map(
          (failure) =>
            `• <b>${htmlText(failure.source, 100)}</b> · ${htmlText(failure.target, 200)}\n  ${htmlText(failure.message, 600)}`,
        )
        .join('\n\n')}`;

export const renderStockDigest = (result: PipelineResult): string => {
  const sections = result.analyses
    .filter(({ outcome }) => outcome.status === 'SUCCESS')
    .map(({ item, outcome }, index) => {
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
        `<b>${index + 1}. ${htmlText(metadataText(item.metadata.target, item.title), MAX_TITLE)}</b>`,
        `${icon} <b>Sentiment:</b> ${htmlText(analysis.sentiment, 50)} · ⭐ <b>Importance:</b> ${analysis.importance}/10`,
        `🏷 <b>Event:</b> ${htmlText(analysis.eventType, 200)}`,
        `<b>${htmlText(analysis.title, MAX_TITLE)}</b>`,
        `📝 <b>Summary</b>\n${htmlText(analysis.summary, MAX_SUMMARY)}`,
        analysis.positives.length
          ? `✅ <b>Positives</b>\n${bulletList(analysis.positives)}`
          : '',
        analysis.negatives.length
          ? `➖ <b>Negatives</b>\n${bulletList(analysis.negatives)}`
          : '',
        analysis.risks.length
          ? `⚠️ <b>Risks</b>\n${bulletList(analysis.risks)}`
          : '',
        analysis.catalysts.length
          ? `🚀 <b>Catalysts</b>\n${bulletList(analysis.catalysts)}`
          : '',
        `🔗 <b>Source:</b> ${sourceLink(item.source, item.url)}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    });

  return [
    '📈 <b>STOCK WATCHER</b>',
    runDurationLine(result),
    sections.join('\n\n──────────\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat(failureSection(result))
    .trim();
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
        `<b>${index + 1}. ${htmlText(analysis.title, MAX_TITLE)}</b>`,
        `🎯 <b>Topic:</b> ${htmlText(metadataText(item.metadata.target), 300)}`,
        `🔎 <b>Relevance:</b> ${analysis.relevance}/10 · ⭐ <b>Importance:</b> ${analysis.importance}/10`,
        `📝 <b>Summary</b>\n${htmlText(analysis.summary, MAX_SUMMARY)}`,
        analysis.keyFindings.length
          ? `🔑 <b>Key findings</b>\n${bulletList(analysis.keyFindings)}`
          : '',
        analysis.methods.length
          ? `🔬 <b>Methods</b>\n${bulletList(analysis.methods)}`
          : '',
        analysis.limitations.length
          ? `⚠️ <b>Limitations</b>\n${bulletList(analysis.limitations)}`
          : '',
        analysis.whyInteresting
          ? `💡 <b>Why it matters</b>\n${htmlText(analysis.whyInteresting, 800)}`
          : '',
        `🔗 <b>Source:</b> ${sourceLink(item.source, item.url)}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    });

  return [
    '🧬 <b>PUBLICATIONS WATCHER</b>',
    runDurationLine(result),
    sections.join('\n\n──────────\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat(failureSection(result))
    .trim();
};
