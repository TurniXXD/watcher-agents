import { escapeHtml } from './utils/html.js';

const percent = (value: number | null): string =>
  value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const metricLine = (
  label: string,
  metric: {
    sampleSize: number;
    hitRatePercent: number | null;
    averageReturnPercent: number | null;
    medianReturnPercent: number | null;
    averageMaximumFavorablePercent: number | null;
    averageMaximumAdversePercent: number | null;
  },
): string =>
  `• <b>${label}</b> · n=${metric.sampleSize} · hit ${percent(metric.hitRatePercent)} · avg ${percent(metric.averageReturnPercent)} · median ${percent(metric.medianReturnPercent)} · MFE ${percent(metric.averageMaximumFavorablePercent)} · MAE ${percent(metric.averageMaximumAdversePercent)}`;

export const renderHistoricalReplay = (replay: {
  ticker: string;
  companyName: string | null;
  asOf: Date;
  price: { observedAt: Date; close: number } | null;
  thesis: {
    verdict: string;
    confidence: number;
    attentionScore: number;
    thesis: string;
  } | null;
  events: {
    detectedAt: Date;
    eventType: string;
    title: string;
    materiality: string;
    source: string;
  }[];
}): string => {
  const company = replay.companyName
    ? `${replay.ticker} — ${escapeHtml(replay.companyName)}`
    : replay.ticker;
  const thesis = replay.thesis
    ? `<b>Thesis at that time</b>\n${escapeHtml(replay.thesis.verdict)} · confidence ${(replay.thesis.confidence * 100).toFixed(0)}% · attention ${replay.thesis.attentionScore}/100\n${escapeHtml(replay.thesis.thesis)}`
    : '<b>Thesis at that time</b>\nNo validated thesis revision existed yet.';
  const events = replay.events.length
    ? replay.events
        .map(
          (event) =>
            `• ${event.detectedAt.toISOString()} · <b>${escapeHtml(event.eventType)}</b> · ${escapeHtml(event.materiality)}\n  ${escapeHtml(event.title)} · ${escapeHtml(event.source)}`,
        )
        .join('\n')
    : 'No events were known at that time.';
  const price = replay.price
    ? `$${replay.price.close.toFixed(2)} (snapshot ${replay.price.observedAt.toISOString()})`
    : 'No historical price snapshot.';
  return `🕰 <b>HISTORICAL REPLAY</b>\n\n<b>${company}</b>\nAs of: ${replay.asOf.toISOString()}\nPrice: ${price}\n\n${thesis}\n\n<b>Events known by then</b>\n${events}\n\n<i>Strict as-of mode: later publications, detections, revisions, and outcomes are excluded.</i>`;
};

export const renderEventReplay = (replay: {
  ticker: string;
  from: Date | null;
  to: Date;
  entries: {
    timestamp: Date;
    kind: 'EVENT' | 'THESIS_REVISION';
    eventType: string;
    title: string;
    verdict: string | null;
    attention: number | null;
  }[];
}): string => {
  const entries = replay.entries.length
    ? replay.entries
        .map((entry) => {
          const state = entry.verdict
            ? ` → ${escapeHtml(entry.verdict)} · attention ${entry.attention ?? 'n/a'}`
            : '';
          return `• ${entry.timestamp.toISOString()} · ${entry.kind === 'EVENT' ? 'event' : 'state'} · <b>${escapeHtml(entry.eventType)}</b>\n  ${escapeHtml(entry.title)}${state}`;
        })
        .join('\n')
    : 'No replayable events in this interval.';
  return `⏯ <b>EVENT REPLAY · ${escapeHtml(replay.ticker)}</b>\n\n${replay.from?.toISOString() ?? 'beginning'} → ${replay.to.toISOString()}\n\n${entries}`;
};

export const renderBacktestSummary = (summary: {
  targetCount: number;
  horizons: Record<
    | 'oneHour'
    | 'oneDay'
    | 'sevenDays'
    | 'thirtyDays'
    | 'ninetyDays'
    | 'twelveMonths',
    Parameters<typeof metricLine>[1]
  >;
  alertTiming: {
    sampleSize: number;
    averagePreDetectionReturnPercent: number | null;
    averageDetectionToNextOpenPercent: number | null;
  };
  breakdowns: {
    verdict: { group: string; metric: Parameters<typeof metricLine>[1] }[];
    signalType: { group: string; metric: Parameters<typeof metricLine>[1] }[];
    marketRegime: { group: string; metric: Parameters<typeof metricLine>[1] }[];
  };
}): string => {
  const horizons = [
    metricLine('1 hour', summary.horizons.oneHour),
    metricLine('1 day', summary.horizons.oneDay),
    metricLine('7 days', summary.horizons.sevenDays),
    metricLine('30 days', summary.horizons.thirtyDays),
    metricLine('90 days', summary.horizons.ninetyDays),
    metricLine('12 months', summary.horizons.twelveMonths),
  ].join('\n');
  const breakdown = (
    title: string,
    groups: { group: string; metric: Parameters<typeof metricLine>[1] }[],
  ) =>
    groups.length
      ? `<b>${title} · 30-day return</b>\n${groups
          .slice(0, 12)
          .map((entry) => metricLine(escapeHtml(entry.group), entry.metric))
          .join('\n')}`
      : `<b>${title}</b>\nNo completed 30-day samples.`;
  return `📐 <b>VALIDATION &amp; BACKTEST</b>\n\nStored targets: ${summary.targetCount}\n\n<b>Outcome horizons</b>\n${horizons}\n\n<b>Alert timing</b>\nAlerts: ${summary.alertTiming.sampleSize} · before detection ${percent(summary.alertTiming.averagePreDetectionReturnPercent)} · detection → next open ${percent(summary.alertTiming.averageDetectionToNextOpenPercent)}\n\n${breakdown('Verdict', summary.breakdowns.verdict)}\n\n${breakdown('Signal type', summary.breakdowns.signalType)}\n\n${breakdown('Market regime', summary.breakdowns.marketRegime)}\n\n<i>n is the number of targets with a real stored price at that horizon. Missing history is never interpolated or invented.</i>`;
};

export const renderCalibration = (
  buckets: readonly {
    label: string;
    sampleSize: number;
    predictedAveragePercent: number | null;
    realizedHigherPercent: number | null;
    calibrationErrorPoints: number | null;
  }[],
): string => {
  const lines = buckets.map(
    (bucket) =>
      `• <b>${escapeHtml(bucket.label)}</b> · n=${bucket.sampleSize} · predicted ${percent(bucket.predictedAveragePercent)} · realized ${percent(bucket.realizedHigherPercent)} · error ${bucket.calibrationErrorPoints === null ? 'n/a' : `${bucket.calibrationErrorPoints >= 0 ? '+' : ''}${bucket.calibrationErrorPoints.toFixed(1)} pp`}`,
  );
  return `🎯 <b>PROBABILITY CALIBRATION · 30 DAYS</b>\n\n${lines.join('\n')}\n\n<i>Calibration reports empirical outcomes only; it does not automatically rewrite model probabilities.</i>`;
};

export const renderSignalPerformance = (
  performance: readonly {
    group: string;
    sufficientSample: boolean;
    metric: Parameters<typeof metricLine>[1];
  }[],
  minimumSampleSize: number,
): string => {
  const lines = performance.length
    ? performance
        .map(
          (entry) =>
            `${entry.sufficientSample ? '✅' : '⚪'} ${metricLine(escapeHtml(entry.group), entry.metric).slice(2)}`,
        )
        .join('\n')
    : 'No signal outcomes have completed a 30-day horizon.';
  return `📊 <b>SIGNAL PERFORMANCE · 30 DAYS</b>\n\n${lines}\n\n<i>✅ adequate sample; ⚪ below the configured minimum of ${minimumSampleSize}. Low-sample results must not drive weighting changes.</i>`;
};
