import { escapeHtml, htmlText, optionalSourceLink } from './html.js';

type SourceListing = { name: string; description: string; url?: string };

const sourceList = (title: string, sources: SourceListing[]): string =>
  [
    `<b>${htmlText(title, 100)}</b>`,
    ...sources.map((source) => {
      const name = optionalSourceLink(source.name, source.url);
      return `• ${name} — ${htmlText(source.description, 500)}`;
    }),
  ].join('\n');

export const renderStockSourceList = (): string =>
  sourceList('📈 Available stock sources', [
    {
      name: 'SEC EDGAR',
      description: 'Company filings and filing documents.',
      url: 'https://www.sec.gov/edgar/searchedgar/companysearch',
    },
    {
      name: 'Investor Relations',
      description:
        'Official issuer RSS/Atom feed auto-discovered from SEC company metadata when available.',
      url: 'https://www.sec.gov/edgar/searchedgar/companysearch',
    },
    {
      name: 'GDELT News',
      description: 'Recent public web-news discovery through GDELT DOC 2.0.',
      url: 'https://www.gdeltproject.org/',
    },
    {
      name: 'TradingView News',
      description:
        'Symbol-specific market headlines and TradingView article pages.',
      url: 'https://www.tradingview.com/news/',
    },
    {
      name: 'FINVIZ Insider Trading',
      description: 'Public insider transaction table with SEC filing links.',
      url: 'https://finviz.com/insidertrading.ashx',
    },
    {
      name: 'Zacks',
      description: 'Public quote, rank, and earnings-date snapshot.',
      url: 'https://www.zacks.com/',
    },
    {
      name: 'Earnings Whispers',
      description: 'Public earnings calendar, estimates, and surprise data.',
      url: 'https://www.earningswhispers.com/',
    },
    {
      name: 'Stooq',
      description: 'Public price snapshots when ticker coverage exists.',
      url: 'https://stooq.com/',
    },
    {
      name: 'Alpha Vantage Market Movers',
      description:
        'Optional market-wide discovery snapshot; requires a server API key.',
      url: 'https://www.alphavantage.co/',
    },
    {
      name: 'Alpha Vantage Institutional Holdings',
      description:
        'Optional periodic institutional-positioning snapshots; requires a server API key and provider entitlement.',
      url: 'https://www.alphavantage.co/documentation/',
    },
    {
      name: 'Alpha Vantage Realtime Options',
      description:
        'Optional option-chain positioning and anomaly snapshots; disabled by default and requires premium entitlement.',
      url: 'https://www.alphavantage.co/documentation/',
    },
    {
      name: 'FINRA Short Interest',
      description:
        'Official consolidated short-position, change, volume, and days-to-cover reports.',
      url: 'https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data',
    },
    {
      name: 'ClinicalTrials.gov',
      description:
        'Official studies matched to the watched company as lead sponsor or collaborator.',
      url: 'https://clinicaltrials.gov/',
    },
    {
      name: 'openFDA Drugs@FDA',
      description:
        'Official drug application and submission status records matched by sponsor name.',
      url: 'https://open.fda.gov/apis/drug/drugsfda/',
    },
    {
      name: 'Quiver Quantitative',
      description:
        'Optional insider, government-contract, patent, congressional-trading, off-exchange, and lobbying datasets; requires a server API token.',
      url: 'https://www.quiverquant.com/',
    },
  ]);

export const renderPublicationSourceList = (): string =>
  sourceList('🧬 Available publication sources', [
    {
      name: 'PubMed',
      description: 'NCBI biomedical publication search and article metadata.',
      url: 'https://pubmed.ncbi.nlm.nih.gov/',
    },
    {
      name: 'bioRxiv',
      description: 'Life-sciences preprints from the official bioRxiv API.',
      url: 'https://www.biorxiv.org/',
    },
    {
      name: 'ClinicalTrials.gov',
      description: 'Structured clinical study records from the v2 API.',
      url: 'https://clinicaltrials.gov/',
    },
    {
      name: 'openFDA',
      description: 'FDA public datasets; currently drug adverse-event search.',
      url: 'https://open.fda.gov/',
    },
  ]);

type AdvancedStockData = {
  symbol: string;
  companyName: string | null;
  options: {
    observedAt: Date;
    callVolume: bigint;
    putVolume: bigint;
    putCallVolumeRatio: unknown;
    putCallOpenInterestRatio: unknown;
    meanImpliedVolatility: unknown;
    maxVolumeOiRatio: unknown;
    anomaly: boolean;
  } | null;
  institutional: {
    reportedAt: Date;
    totalShares: unknown;
    totalValueUsd: unknown;
    netShareChange: unknown;
    changePercent: unknown;
    holderCount: number | null;
    materialChange: boolean;
  } | null;
  shortInterest: {
    settlementDate: Date;
    currentShortPosition: bigint;
    changePercent: unknown;
    daysToCover: unknown;
    materialChange: boolean;
  } | null;
  regulatoryEvents: Array<{
    eventType: string;
    title: string;
    materiality: string;
    firstDetectedAt: Date;
    primaryEvidence: { source: string; sourceUrl: string | null; url: string };
  }>;
};

const compactNumber = (value: unknown): string => {
  if (value === null || value === undefined) return 'n/a';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        number,
      )
    : 'n/a';
};

export const renderAdvancedStockData = (
  entries: AdvancedStockData[],
): string => {
  if (!entries.length) return '<b>Advanced data</b>\nNo matching stocks.';
  return [
    '<b>🧭 Advanced stock data</b>',
    ...entries.map((entry) => {
      const name = entry.companyName
        ? `${entry.symbol} — ${entry.companyName}`
        : entry.symbol;
      const options = entry.options
        ? [
            `<b>Options</b> · ${entry.options.observedAt.toISOString().slice(0, 10)}${entry.options.anomaly ? ' · ⚠️ anomaly' : ''}`,
            `Calls/puts volume: ${entry.options.callVolume.toLocaleString('en-US')} / ${entry.options.putVolume.toLocaleString('en-US')}`,
            `Put/call volume: ${compactNumber(entry.options.putCallVolumeRatio)} · OI: ${compactNumber(entry.options.putCallOpenInterestRatio)} · IV: ${compactNumber(entry.options.meanImpliedVolatility)} · max vol/OI: ${compactNumber(entry.options.maxVolumeOiRatio)}`,
          ].join('\n')
        : '<b>Options</b> · no snapshot';
      const institutional = entry.institutional
        ? [
            `<b>Institutional</b> · ${entry.institutional.reportedAt.toISOString().slice(0, 10)}${entry.institutional.materialChange ? ' · ⚠️ material change' : ''}`,
            `Shares: ${compactNumber(entry.institutional.totalShares)} · value: $${compactNumber(entry.institutional.totalValueUsd)} · net change: ${compactNumber(entry.institutional.netShareChange)} (${compactNumber(entry.institutional.changePercent)}%) · holders: ${entry.institutional.holderCount ?? 'n/a'}`,
          ].join('\n')
        : '<b>Institutional</b> · no snapshot';
      const shortInterest = entry.shortInterest
        ? [
            `<b>Short interest</b> · ${entry.shortInterest.settlementDate.toISOString().slice(0, 10)}${entry.shortInterest.materialChange ? ' · ⚠️ material change' : ''}`,
            `Position: ${entry.shortInterest.currentShortPosition.toLocaleString('en-US')} · change: ${compactNumber(entry.shortInterest.changePercent)}% · days to cover: ${compactNumber(entry.shortInterest.daysToCover)}`,
          ].join('\n')
        : '<b>Short interest</b> · no snapshot';
      const regulatory = entry.regulatoryEvents.length
        ? [
            '<b>Regulatory / clinical</b>',
            ...entry.regulatoryEvents.map(
              (event) =>
                `• ${event.eventType} · ${event.materiality} · ${optionalSourceLink(event.title, event.primaryEvidence.sourceUrl ?? event.primaryEvidence.url)}`,
            ),
          ].join('\n')
        : '<b>Regulatory / clinical</b> · no events';
      return `<b>${htmlText(name, 200)}</b>\n${options}\n${institutional}\n${shortInterest}\n${regulatory}`;
    }),
  ].join('\n\n');
};
