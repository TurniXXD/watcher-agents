import type { DiscoveryExecution } from './discovery.js';

const telegramMessageLimit = 3_600;

type RecommendedCandidate = Extract<
  DiscoveryExecution,
  { status: 'COMPLETED' }
>['recommendedCandidates'][number];

const compact = (value: string): string => value.replaceAll(/\s+/g, ' ').trim();

export const renderWeeklyDiscoveryReport = (
  candidates: readonly RecommendedCandidate[],
): string => {
  const lines = ['🔎 Weekly stock discovery', ''];
  if (candidates.length === 0) {
    lines.push('No candidates met the quality filters this week.');
  } else {
    for (const candidate of candidates) {
      const entry = [
        `• ${compact(candidate.ticker)} — ${compact(candidate.companyName)} · ${candidate.changePercent >= 0 ? '+' : ''}${candidate.changePercent.toFixed(2)}% · attention ${candidate.attentionScore}/100`,
        `  ${compact(candidate.reason)}`,
      ];
      if ([...lines, ...entry].join('\n').length > telegramMessageLimit) {
        lines.push('• …additional candidates are available in /discovery.');
        break;
      }
      lines.push(...entry);
    }
  }
  lines.push(
    '',
    'Nothing was added to your watchlist. Add a company explicitly with /add_stock SYMBOL to start five-minute news monitoring.',
  );
  return lines.join('\n');
};
