export type CompanyIntelligenceRelationship = 'SUBJECT' | 'PEER';

export type CompanyIntelligenceEndpoint = {
  name: string;
  url: string;
  relationship: CompanyIntelligenceRelationship;
  relatedTicker?: string;
};

export type CompanyIntelligenceProfile = {
  symbol: string;
  focus: string;
  endpoints: readonly CompanyIntelligenceEndpoint[];
};

/**
 * Curated, first-party announcement pages for the small, high-resolution
 * watchlist. These are deliberately static rather than Telegram-configurable:
 * the source must never fetch an arbitrary user-supplied URL.
 */
export const companyIntelligenceProfiles: ReadonlyMap<
  string,
  CompanyIntelligenceProfile
> = new Map([
  [
    'CRDO',
    {
      symbol: 'CRDO',
      focus: 'high-speed connectivity for AI and cloud infrastructure',
      endpoints: [
        {
          name: 'Credo investor relations',
          url: 'https://investors.credosemi.com/news-events/news/default.aspx',
          relationship: 'SUBJECT',
          relatedTicker: 'CRDO',
        },
        {
          name: 'Marvell press releases',
          url: 'https://investor.marvell.com/news-events/press-releases',
          relationship: 'PEER',
          relatedTicker: 'MRVL',
        },
        {
          name: 'Astera Labs news releases',
          url: 'https://ir.asteralabs.com/news-events/news-releases',
          relationship: 'PEER',
          relatedTicker: 'ALAB',
        },
      ],
    },
  ],
  [
    'MU',
    {
      symbol: 'MU',
      focus: 'DRAM, HBM, NAND and AI memory demand',
      endpoints: [
        {
          name: 'Micron newsroom',
          url: 'https://www.micron.com/about/press/news',
          relationship: 'SUBJECT',
          relatedTicker: 'MU',
        },
        {
          name: 'SK hynix press',
          url: 'https://news.skhynix.com/en/category/press/',
          relationship: 'PEER',
        },
        {
          name: 'Kioxia news',
          url: 'https://www.kioxia.com/en-jp/news.html',
          relationship: 'PEER',
        },
      ],
    },
  ],
  [
    'SNDK',
    {
      symbol: 'SNDK',
      focus: 'NAND flash, enterprise storage and AI data infrastructure',
      endpoints: [
        {
          name: 'Sandisk investor relations',
          url: 'https://investor.sandisk.com/news/default.aspx',
          relationship: 'SUBJECT',
          relatedTicker: 'SNDK',
        },
        {
          name: 'Kioxia news',
          url: 'https://www.kioxia.com/en-jp/news.html',
          relationship: 'PEER',
        },
        {
          name: 'Western Digital press releases',
          url: 'https://investor.wdc.com/news-events/press-releases/default.aspx',
          relationship: 'PEER',
          relatedTicker: 'WDC',
        },
      ],
    },
  ],
  [
    'DOCN',
    {
      symbol: 'DOCN',
      focus: 'AI-native cloud, GPU infrastructure and developer cloud demand',
      endpoints: [
        {
          name: 'DigitalOcean investor relations',
          url: 'https://investors.digitalocean.com/news/default.aspx',
          relationship: 'SUBJECT',
          relatedTicker: 'DOCN',
        },
        {
          name: 'CoreWeave newsroom',
          url: 'https://www.coreweave.com/newsroom',
          relationship: 'PEER',
          relatedTicker: 'CRWV',
        },
        {
          name: 'Cloudflare press releases',
          url: 'https://www.cloudflare.com/press/press-releases/',
          relationship: 'PEER',
          relatedTicker: 'NET',
        },
      ],
    },
  ],
]);

export const companyIntelligenceProfileFor = (
  symbol: string,
): CompanyIntelligenceProfile | undefined =>
  companyIntelligenceProfiles.get(symbol.trim().toUpperCase());
