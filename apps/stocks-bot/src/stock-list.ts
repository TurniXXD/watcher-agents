import { htmlText, optionalSourceLink } from '@watcher/telegram';

export type StockListEntry = {
  id: string;
  symbol: string;
  companyName: string | null;
  cik: string | null;
  enabled: boolean;
  monitoringTier: string;
  monitoringMode: string;
  priority: number;
  autoDiscovered: boolean;
  attentionScore: number;
  investigateUntil: Date | null;
  watchReason: string | null;
  watchUntil: Date | null;
  discoverySignals?: Array<{
    source: string;
    trigger: string;
    reason: string;
  }>;
  watchReasonSource?: { source: string; url: string } | null;
};

const discoverySource = (source: string): { name: string; url?: string } => {
  if (source === 'ALPHA_VANTAGE_MARKET_MOVERS') {
    return {
      name: 'Alpha Vantage Market Movers',
      url: 'https://www.alphavantage.co/',
    };
  }
  return { name: source.replaceAll('_', ' ') };
};

const displayToken = (value: string): string =>
  /^[A-Z0-9-]{2,6}$/.test(value)
    ? value
    : value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/(^|\s)\S/g, (character) => character.toUpperCase());

const dateTime = (value: Date): string =>
  value
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');

const renderEntry = (stock: StockListEntry): string => {
  const origin = stock.discoverySignals?.[0];
  const provider = origin ? discoverySource(origin.source) : undefined;
  return [
    `${stock.enabled ? '✅' : '⏸'} <b>${htmlText(stock.symbol, 20)}</b>${stock.companyName ? ` — ${htmlText(stock.companyName, 200)}` : ''}`,
    `🎯 <b>Tier:</b> ${htmlText(stock.monitoringTier, 40)}`,
    `⚙️ <b>Mode:</b> ${htmlText(stock.monitoringMode, 40)}`,
    `⭐ <b>Priority:</b> ${stock.priority}/100`,
    stock.autoDiscovered
      ? `🔎 <b>Discovery:</b> Auto-discovered · attention ${stock.attentionScore}/100`
      : '',
    stock.autoDiscovered && provider && origin
      ? `🌐 <b>Discovery source:</b> ${optionalSourceLink(provider.name, provider.url)} · ${htmlText(displayToken(origin.trigger), 100)}`
      : '',
    stock.autoDiscovered && origin && origin.reason !== stock.watchReason
      ? `💡 <b>Discovery reason:</b> ${htmlText(origin.reason, 500)}`
      : '',
    stock.investigateUntil
      ? `⏳ <b>Investigation until:</b> ${dateTime(stock.investigateUntil)}`
      : '',
    stock.watchUntil
      ? `📅 <b>Watch until:</b> ${dateTime(stock.watchUntil)}`
      : '',
    stock.watchReason
      ? `📝 <b>Reason:</b> ${htmlText(stock.watchReason, 500)}`
      : '',
    stock.watchReasonSource
      ? `📰 <b>Watch source:</b> ${optionalSourceLink(displayToken(stock.watchReasonSource.source), stock.watchReasonSource.url)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
};

export const renderStockList = (stocks: StockListEntry[]): string => {
  const watchedCount = stocks.filter(({ enabled }) => enabled).length;
  const pausedCount = stocks.length - watchedCount;
  const discoveredCount = stocks.filter(
    ({ autoDiscovered }) => autoDiscovered,
  ).length;
  const header = [
    '📈 <b>WATCHED STOCKS</b>',
    `👀 <b>Currently watched:</b> ${watchedCount}`,
    `📋 <b>Configured:</b> ${stocks.length} · <b>Paused:</b> ${pausedCount} · <b>Auto-discovered:</b> ${discoveredCount}`,
  ].join('\n');

  if (stocks.length === 0) return `${header}\n\nNo stocks configured.`;
  return `${header}\n\n${stocks.map(renderEntry).join('\n\n──────────\n\n')}`;
};
