import {
  recordValue,
  type PipelineResult,
  type PublicationAnalysis,
  type RunProgress,
  type StockAnalysis,
  type StockThesisState,
} from '@watcher/core';
import type { Api } from 'grammy';
import {
  escapeHtml,
  htmlText,
  optionalSourceLink,
  sourceLink,
} from './html.js';

const LIMIT = 4000;
const MAX_TITLE = 500;
const MAX_SUMMARY = 1500;
const MAX_LIST_ITEM = 400;
const MAX_LIST_ITEMS = 6;

const metadataText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;

const bulletList = (values: string[]): string =>
  values
    .slice(0, MAX_LIST_ITEMS)
    .map((value) => `• ${htmlText(value, MAX_LIST_ITEM)}`)
    .join('\n');

const jsonStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const numericText = (value: unknown, digits = 1): string => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : 'n/a';
};

const dateTimeText = (value: Date | null | undefined): string =>
  value?.toISOString() ?? 'never';

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

const dataCoverageLine = (result: PipelineResult): string =>
  result.dataCoverage
    ? `📡 <b>Data coverage:</b> ${result.dataCoverage.percentage}% (${result.dataCoverage.successfulSources}/${result.dataCoverage.expectedSources} sources)`
    : '';

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

const materialityIcon = (value: string): string => {
  if (value === 'EXTREME') return '🚨';
  if (value === 'HIGH') return '🔴';
  if (value === 'MEDIUM') return '🟠';
  if (value === 'LOW') return '🟡';
  return '⚪';
};

const intelligenceSection = (result: PipelineResult): string => {
  const intelligence = result.intelligence;
  if (!intelligence) return '';
  const visible = intelligence.events.filter(
    ({ decision }) => decision !== 'DUPLICATE',
  );
  const signalDetails = (event: (typeof visible)[number]): string => {
    const magnitude = event.magnitude ?? {};
    const parts: string[] = [];
    const add = (label: string, value: unknown): void => {
      if (typeof value === 'string' || typeof value === 'number')
        parts.push(`${label}: ${String(value)}`);
    };
    if (event.eventType === 'INSIDER_TRANSACTION') {
      add('Type', magnitude.transactionType);
      add('Insider', magnitude.insider);
      add('Value USD', magnitude.transactionValueUsd);
      add('Holdings change %', magnitude.holdingsChangePercent);
      add('Conviction', magnitude.convictionScore);
      add('30d cluster', magnitude.clusterSize);
    } else if (
      event.eventType === 'PRICE_ANOMALY' ||
      event.eventType === 'VOLUME_ANOMALY'
    ) {
      add('Daily move %', magnitude.dailyReturnPercent);
      add('Gap %', magnitude.gapPercent);
      add('Relative volume', magnitude.relativeVolume);
      add('Cause', magnitude.cause);
    } else if (event.eventType === 'OFF_EXCHANGE_ANOMALY') {
      add('DPI', magnitude.dpi);
      add('Relative DPI', magnitude.relativeDpi);
    }
    return parts.length ? `\n${htmlText(parts.join(' · '), 700)}` : '';
  };
  const lines = visible
    .slice(0, 12)
    .map(
      (event) =>
        `${materialityIcon(event.materiality)} <b>${htmlText(event.ticker, 30)}</b> · ${htmlText(event.eventType, 100)} · ${htmlText(event.materiality, 20)}\n${htmlText(event.title, 500)}${signalDetails(event)}\n<i>${htmlText(event.decision === 'ANALYZE' ? 'Analyzed' : event.decision === 'COOLDOWN' ? 'Stored; ticker cooldown active' : 'Stored without LLM analysis', 100)}</i>`,
    );
  const counters = [
    `${intelligence.newEventCount} new`,
    `${intelligence.duplicateEventCount} duplicates`,
    `${intelligence.storedOnlyCount} stored`,
    `${intelligence.cooldownCount} cooldown`,
  ].join(' · ');
  return [`🧭 <b>Event processing</b>\n${counters}`, lines.join('\n\n')]
    .filter(Boolean)
    .join('\n\n');
};

export const renderCatalystList = (
  catalysts: Array<{
    ticker: string;
    catalystType: string;
    description: string;
    expectedStart: Date | null;
    expectedEnd: Date | null;
    exactDateKnown: boolean;
    proximity: string;
    impact: string;
    direction: string;
    status: string;
    event?: {
      primaryEvidence: {
        source: string;
        sourceUrl: string | null;
        primarySource: boolean;
      };
    };
  }>,
): string => {
  if (!catalysts.length) return 'No active or upcoming catalysts found.';
  return [
    '📅 <b>Catalyst registry</b>',
    ...catalysts.map((catalyst) => {
      const date = catalyst.expectedStart
        ? catalyst.expectedStart.toISOString().slice(0, 10)
        : 'date not confirmed';
      const range = catalyst.expectedEnd
        ? `–${catalyst.expectedEnd.toISOString().slice(0, 10)}`
        : '';
      const evidence = catalyst.event?.primaryEvidence;
      const evidenceLine = evidence?.sourceUrl
        ? `\n🔗 Evidence: ${sourceLink(evidence.source, evidence.sourceUrl)}${evidence.primarySource ? ' · primary' : ' · provider observation'}`
        : '';
      return `${materialityIcon(catalyst.impact)} <b>${htmlText(catalyst.ticker, 30)}</b> · ${htmlText(catalyst.catalystType, 80)}\n${htmlText(catalyst.description, 500)}\n📆 ${date}${range}${catalyst.exactDateKnown ? ' · exact date' : ''}\n${htmlText(`${catalyst.status} · ${catalyst.proximity} proximity · ${catalyst.impact} impact · ${catalyst.direction} direction`, 300)}${evidenceLine}`;
    }),
  ].join('\n\n');
};

export const renderStockThesis = (state: StockThesisState): string => {
  const availableSignals = state.signalGroups.filter(
    ({ availability, score }) => availability === 'AVAILABLE' && score !== 0,
  );
  const decision = state.decision;
  const probabilityLine = decision
    ? Object.entries(decision.probabilityHigher)
        .filter(
          (entry): entry is [string, { minimum: number; maximum: number }] =>
            entry[1] !== null,
        )
        .map(
          ([horizon, range]) =>
            `${horizon}: ${range.minimum.toFixed(0)}–${range.maximum.toFixed(0)}%`,
        )
        .join(' · ')
    : '';
  return [
    `🧠 <b>${htmlText(state.ticker, 30)} THESIS</b>`,
    `<b>Verdict:</b> ${htmlText(state.verdict, 40)} · <b>Confidence:</b> ${Math.round(state.confidence * 100)}% · <b>Attention:</b> ${state.attentionScore}/100`,
    `<b>Net signal:</b> ${state.netSignal.toFixed(2)} · Bull ${state.bullScore.toFixed(2)} / Bear ${state.bearScore.toFixed(2)}`,
    `📡 <b>Coverage:</b> ${Math.round(state.dataCoverage)}% · ${htmlText(state.dataQuality, 20)} quality`,
    `📝 <b>Current thesis</b>\n${htmlText(state.thesis, MAX_SUMMARY)}`,
    state.primaryDrivers.length
      ? `🧭 <b>Primary drivers</b>\n${bulletList(state.primaryDrivers)}`
      : '',
    availableSignals.length
      ? `📊 <b>Signal groups</b>\n${availableSignals
          .map(
            ({ group, score, explanation }) =>
              `• ${score > 0 ? '+' : ''}${score.toFixed(2)} <b>${htmlText(group, 80)}</b> — ${htmlText(explanation, 300)}`,
          )
          .join('\n')}`
      : '',
    state.catalysts.length
      ? `🚀 <b>Catalysts</b>\n${bulletList(state.catalysts)}`
      : '',
    state.risks.length ? `⚠️ <b>Risks</b>\n${bulletList(state.risks)}` : '',
    state.materialDataGaps.length
      ? `🕳 <b>Material data gaps</b>\n${bulletList(state.materialDataGaps)}`
      : '',
    decision
      ? `⚖️ <b>Decision engine</b>\nExpected value: ${decision.expectedValuePercent === null ? 'insufficient data' : `${decision.expectedValuePercent.toFixed(1)}%`} · Asymmetry: ${htmlText(decision.asymmetry, 30)}\nPriced in: ${htmlText(decision.pricedIn.classification, 50)}\nMax suggested position: ${decision.maxRecommendedPositionPercent.minimum.toFixed(1)}–${decision.maxRecommendedPositionPercent.maximum.toFixed(1)}%\n${probabilityLine ? `Probability higher: ${htmlText(probabilityLine, 500)}\n` : ''}<i>Research output only; human review required.</i>`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export type StockAlertView = {
  ticker: string;
  type: string;
  severity: string;
  title: string;
  reasons: unknown;
  snapshot: unknown;
  createdAt: Date;
  sentAt?: Date | null;
  event: {
    primaryEvidence: {
      source: string;
      sourceUrl: string | null;
      url: string;
    };
  };
};

export const renderStockAlert = (alert: StockAlertView): string => {
  const snapshot = recordValue(alert.snapshot);
  const reasons = jsonStrings(alert.reasons);
  const expectedValue = snapshot.expectedValuePercent;
  const latencySeconds = Math.max(
    0,
    Math.round((Date.now() - alert.createdAt.getTime()) / 1000),
  );
  return [
    `${alert.severity === 'EXTREME' ? '🚨' : '🔔'} <b>STOCK ALERT · ${htmlText(alert.severity, 20)}</b>`,
    `<b>${htmlText(alert.ticker, 30)}</b> · ${htmlText(alert.type, 80)}`,
    `<b>${htmlText(alert.title, MAX_TITLE)}</b>`,
    reasons.length ? `🧭 <b>Why now</b>\n${bulletList(reasons)}` : '',
    `🧠 <b>Thesis</b>\nVerdict: ${htmlText(metadataText(snapshot.verdict, 'unknown'), 50)} · Attention: ${htmlText(metadataText(snapshot.attentionScore, 'n/a'), 20)}/100 · Net signal: ${numericText(snapshot.netSignal, 2)}\nChange: ${htmlText(metadataText(snapshot.thesisChange, 'unknown'), 60)} · Coverage: ${htmlText(metadataText(snapshot.dataCoverage, 'n/a'), 20)}%`,
    `⚖️ <b>Decision</b>\n${htmlText(metadataText(snapshot.recommendation, 'human review'), 60)} · EV ${expectedValue === null || expectedValue === undefined ? 'n/a' : `${numericText(expectedValue)}%`} · Priced in: ${htmlText(metadataText(snapshot.pricedIn, 'unknown'), 60)}`,
    `🔗 <b>Evidence:</b> ${optionalSourceLink(alert.event.primaryEvidence.source, alert.event.primaryEvidence.sourceUrl ?? alert.event.primaryEvidence.url)}`,
    `⏱ <b>Alert latency:</b> ${formatRunDuration(latencySeconds * 1000)}`,
    '<i>Research signal only. No information leak or guaranteed trade is inferred; human review is required.</i>',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export type StockDashboardEntry = {
  stock: {
    symbol: string;
    companyName: string | null;
    monitoringTier: string;
    monitoringMode: string;
    attentionScore: number;
  };
  thesis: {
    verdict: string;
    attentionScore: number;
    netSignal: number;
    insiderConviction: number | null;
    dataCoverage: number;
    decision: unknown;
    updatedAt: Date;
  } | null;
  price: {
    close: unknown;
    dailyReturnPercent: unknown;
    observedAt: Date;
  } | null;
  catalyst: {
    catalystType: string;
    impact: string;
    proximity: string;
    expectedStart: Date | null;
  } | null;
  lastEvent: {
    eventType: string;
    firstDetectedAt: Date;
  } | null;
  lastRevision: {
    thesisChange: string;
    createdAt: Date;
  } | null;
};

const dashboardEntry = (entry: StockDashboardEntry): string => {
  const decision = recordValue(entry.thesis?.decision);
  const probability = recordValue(decision.probabilityHigher);
  const oneMonth = recordValue(probability.thirtyDays);
  const probabilityText =
    typeof oneMonth.minimum === 'number' && typeof oneMonth.maximum === 'number'
      ? `${oneMonth.minimum.toFixed(0)}–${oneMonth.maximum.toFixed(0)}% 1m`
      : 'probability n/a';
  const dailyMove = entry.price?.dailyReturnPercent;
  const dailyMoveNumber =
    dailyMove === null || dailyMove === undefined ? null : Number(dailyMove);
  const company = entry.stock.companyName
    ? `${entry.stock.symbol} — ${entry.stock.companyName}`
    : entry.stock.symbol;
  const lastUpdate =
    entry.thesis?.updatedAt ??
    entry.lastEvent?.firstDetectedAt ??
    entry.price?.observedAt;
  return [
    `<b>${htmlText(company, 180)}</b>`,
    `💵 ${numericText(entry.price?.close, 2)}${dailyMoveNumber === null || !Number.isFinite(dailyMoveNumber) ? '' : ` · ${dailyMoveNumber >= 0 ? '+' : ''}${dailyMoveNumber.toFixed(2)}%`}`,
    `🎛 ${htmlText(entry.stock.monitoringTier, 30)} · ${htmlText(entry.stock.monitoringMode, 40)}`,
    `🧠 ${htmlText(entry.thesis?.verdict ?? 'NO_THESIS', 40)} · Attention ${entry.thesis?.attentionScore ?? entry.stock.attentionScore}/100 · Signal ${numericText(entry.thesis?.netSignal, 2)}`,
    `⚖️ ${probabilityText} · ${htmlText(metadataText(decision.asymmetry, 'asymmetry n/a'), 40)}`,
    `🚀 ${entry.catalyst ? `${htmlText(entry.catalyst.catalystType, 70)} · ${htmlText(entry.catalyst.impact, 20)} · ${htmlText(entry.catalyst.proximity, 20)}` : 'no active catalyst'} · Insider ${numericText(entry.thesis?.insiderConviction, 0)}`,
    `📡 Coverage ${numericText(entry.thesis?.dataCoverage, 0)}% · Thesis ${htmlText(entry.lastRevision?.thesisChange ?? 'n/a', 40)}`,
    `🕒 ${entry.lastEvent ? htmlText(entry.lastEvent.eventType, 60) : 'no event'} · ${dateTimeText(lastUpdate)}`,
  ].join('\n');
};

export const renderStockDashboard = (entries: StockDashboardEntry[]): string =>
  entries.length === 0
    ? 'No enabled stocks are configured.'
    : ['📊 <b>STOCK DASHBOARD</b>', ...entries.map(dashboardEntry)].join(
        '\n\n──────────\n\n',
      );

export const renderOpportunityFeed = (
  entries: StockDashboardEntry[],
): string => {
  const opportunities = entries.filter((entry) => {
    const decision = recordValue(entry.thesis?.decision);
    return (
      entry.thesis !== null &&
      (entry.thesis.attentionScore >= 70 ||
        ['WATCH', 'WAIT_FOR_CONFIRMATION'].includes(
          metadataText(decision.recommendation),
        ) ||
        ['STRONGLY_POSITIVE', 'POSITIVE'].includes(
          metadataText(decision.asymmetry),
        ))
    );
  });
  return opportunities.length === 0
    ? 'No current opportunities meet the attention or asymmetry threshold.'
    : ['🎯 <b>OPPORTUNITY FEED</b>', ...opportunities.map(dashboardEntry)].join(
        '\n\n──────────\n\n',
      );
};

export const renderRecentStockAlerts = (alerts: StockAlertView[]): string =>
  alerts.length === 0
    ? 'No stock alerts have been generated yet.'
    : [
        '🔔 <b>RECENT STOCK ALERTS</b>',
        ...alerts.map(
          (alert) =>
            `${materialityIcon(alert.severity)} <b>${htmlText(alert.ticker, 30)}</b> · ${htmlText(alert.type, 80)}\n${htmlText(alert.title, 300)}\n${alert.sentAt ? `Sent ${alert.sentAt.toISOString()}` : `Pending · attempts recorded`}`,
        ),
      ].join('\n\n');

export type WatcherHealthView = {
  runInProgress: boolean;
  lastSuccessfulPoll: Date | null;
  lastRunStatus: string | null;
  nextRunAt: Date | null;
  lastReconciliationAt: Date | null;
  nextReconciliationAt: Date | null;
  reconciliationInProgress: boolean;
  pendingAlerts: number;
  alertsGenerated: number;
  duplicatesPrevented: number;
  analysisQueueDepth: number;
  sourceFailures: number;
  failedAnalyses: number;
  rateLimitedSources: number;
  sourceCoveragePercent: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  averageAnalysisDurationMs: number | null;
  averageEventAnalysisLatencyMs: number | null;
  averageAlertDeliveryLatencyMs: number | null;
  estimatedLlmCostUsd: number;
  sourceHealth: Array<{
    source: string;
    target: string;
    status: string;
    consecutiveFailures: number;
    lastSuccessAt: Date | null;
    backoffUntil: Date | null;
    lastError: string | null;
  }>;
};

export const renderWatcherHealth = (health: WatcherHealthView): string => {
  const unhealthy = health.sourceHealth.filter(
    ({ status }) => status !== 'HEALTHY',
  );
  return [
    '🩺 <b>WATCHER HEALTH</b>',
    `Run: ${health.runInProgress ? 'in progress' : (health.lastRunStatus ?? 'never')} · Last success ${dateTimeText(health.lastSuccessfulPoll)} · Next ${dateTimeText(health.nextRunAt)}`,
    `Reconciliation: ${health.reconciliationInProgress ? 'in progress' : 'idle'} · Last ${dateTimeText(health.lastReconciliationAt)} · Next ${dateTimeText(health.nextReconciliationAt)}`,
    `Alerts: ${health.pendingAlerts} pending / ${health.alertsGenerated} generated · Duplicates prevented: ${health.duplicatesPrevented}`,
    `Queue: ${health.analysisQueueDepth} analyses · Failures: ${health.failedAnalyses} analyses / ${health.sourceFailures} source requests`,
    `LLM: ${health.llmCalls} calls · ${health.promptTokens} prompt / ${health.completionTokens} completion tokens · Avg ${health.averageAnalysisDurationMs === null ? 'n/a' : formatRunDuration(health.averageAnalysisDurationMs)} · Est. $${health.estimatedLlmCostUsd.toFixed(4)}`,
    `Latency: event→analysis ${health.averageEventAnalysisLatencyMs === null ? 'n/a' : formatRunDuration(health.averageEventAnalysisLatencyMs)} · analysis→alert ${health.averageAlertDeliveryLatencyMs === null ? 'n/a' : formatRunDuration(health.averageAlertDeliveryLatencyMs)}`,
    `Sources: ${health.sourceHealth.length - unhealthy.length} healthy / ${health.sourceHealth.length} observed · ${health.sourceCoveragePercent}% coverage · ${health.rateLimitedSources} rate-limited`,
    unhealthy.length
      ? `⚠️ <b>Degraded sources</b>\n${unhealthy
          .slice(0, 12)
          .map(
            (source) =>
              `• <b>${htmlText(source.source, 80)}</b> · ${htmlText(source.target, 120)} · ${htmlText(source.status, 30)} (${source.consecutiveFailures})${source.backoffUntil ? ` · retry after ${source.backoffUntil.toISOString()}` : ''}${source.lastError ? `\n  ${htmlText(source.lastError, 300)}` : ''}`,
          )
          .join('\n')}`
      : '✅ All observed sources are healthy.',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const renderStockDigest = (result: PipelineResult): string => {
  const sections = result.analyses
    .filter(({ outcome }) => outcome.status === 'SUCCESS')
    .map(({ item, outcome }, index) => {
      const analysis =
        outcome.status === 'SUCCESS'
          ? (outcome.result as StockAnalysis)
          : undefined;
      if (!analysis) return '';
      const intelligence = analysis.intelligence;
      const decision = intelligence?.decision;
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
        intelligence
          ? `🧠 <b>Thesis update</b>\n${htmlText(intelligence.targeted.thesisChange, 60)} · ${htmlText(intelligence.targeted.informationChange, 60)}\nVerdict: <b>${htmlText(intelligence.state.verdict, 40)}</b> · Attention: ${intelligence.state.attentionScore}/100 · Net signal: ${intelligence.state.netSignal.toFixed(2)}\nCoverage: ${Math.round(intelligence.state.dataCoverage)}% (${htmlText(intelligence.state.dataQuality, 20)}) · ${intelligence.fullAnalysisPerformed ? 'full analysis performed' : 'targeted analysis only'}\nPrimary driver: ${htmlText(intelligence.targeted.primaryDriver, 500)}\n${htmlText(intelligence.targeted.explanation, 900)}`
          : '',
        decision
          ? `⚖️ <b>Decision</b>\n${htmlText(decision.recommendation, 40)} · EV ${decision.expectedValuePercent === null ? 'n/a' : `${decision.expectedValuePercent.toFixed(1)}%`} · ${htmlText(decision.asymmetry, 40)} asymmetry\nPriced in: ${htmlText(decision.pricedIn.classification, 60)} · Max position ${decision.maxRecommendedPositionPercent.minimum.toFixed(1)}–${decision.maxRecommendedPositionPercent.maximum.toFixed(1)}%\n<i>Research output only; human review required.</i>`
          : '',
        `🔗 <b>Source:</b> ${sourceLink(item.source, item.url)}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    });

  return [
    '📈 <b>STOCK WATCHER</b>',
    runDurationLine(result),
    dataCoverageLine(result),
    intelligenceSection(result),
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
    dataCoverageLine(result),
    sections.join('\n\n──────────\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat(failureSection(result))
    .trim();
};
