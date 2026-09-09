export type NewsScope = 'CZECH' | 'GLOBAL';

type BuiltInNewsSourceBase = {
  key: string;
  name: string;
  scope: NewsScope;
  homepageUrl: string;
};

export type BuiltInRssNewsSource = BuiltInNewsSourceBase & {
  adapter: 'RSS';
  feedUrl: string;
};

export type BuiltInGdeltNewsSource = BuiltInNewsSourceBase & {
  adapter: 'GDELT';
  query: string;
};

export type BuiltInNewsSource = BuiltInRssNewsSource | BuiltInGdeltNewsSource;

export const builtInNewsSources = [
  {
    key: 'czech-irozhlas',
    name: 'iROZHLAS',
    scope: 'CZECH',
    homepageUrl: 'https://www.irozhlas.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.irozhlas.cz/rss/irozhlas',
  },
  {
    key: 'czech-ct24',
    name: 'ČT24',
    scope: 'CZECH',
    homepageUrl: 'https://ct24.ceskatelevize.cz/',
    adapter: 'RSS',
    feedUrl: 'https://ct24.ceskatelevize.cz/rss/hlavni-zpravy',
  },
  {
    key: 'czech-ctk',
    name: 'ČTK',
    scope: 'CZECH',
    homepageUrl: 'https://www.ceskenoviny.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.ceskenoviny.cz/sluzby/rss/zpravy.php',
  },
  {
    key: 'czech-seznam-zpravy',
    name: 'Seznam Zprávy',
    scope: 'CZECH',
    homepageUrl: 'https://www.seznamzpravy.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.seznamzpravy.cz/rss',
  },
  {
    key: 'czech-hospodarske-noviny',
    name: 'Hospodářské noviny',
    scope: 'CZECH',
    homepageUrl: 'https://hn.cz/',
    adapter: 'RSS',
    feedUrl: 'https://hn.cz/?m=rss',
  },
  {
    key: 'czech-denik-n',
    name: 'Deník N',
    scope: 'CZECH',
    homepageUrl: 'https://denikn.cz/',
    adapter: 'RSS',
    feedUrl: 'https://denikn.cz/feed/',
  },
  {
    key: 'czech-respekt',
    name: 'Respekt',
    scope: 'CZECH',
    homepageUrl: 'https://www.respekt.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.respekt.cz/api/rss',
  },
  {
    key: 'czech-aktualne',
    name: 'Aktuálně.cz',
    scope: 'CZECH',
    homepageUrl: 'https://www.aktualne.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.aktualne.cz/rss/',
  },
  {
    key: 'czech-novinky',
    name: 'Novinky.cz',
    scope: 'CZECH',
    homepageUrl: 'https://www.novinky.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.novinky.cz/rss',
  },
  {
    key: 'czech-cnb',
    name: 'ČNB',
    scope: 'CZECH',
    homepageUrl: 'https://www.cnb.cz/',
    adapter: 'RSS',
    feedUrl: 'https://www.cnb.cz/cs/.content/rss-feed/rss-feed_tz.rss',
  },
  {
    key: 'czech-csu',
    name: 'ČSÚ',
    scope: 'CZECH',
    homepageUrl: 'https://csu.gov.cz/',
    adapter: 'RSS',
    feedUrl:
      'https://csu.gov.cz/rss/aktuality?webKod=statistika,produkty,rychle-informace&jazyk=CS',
  },
  {
    key: 'czech-vlada',
    name: 'Vláda ČR',
    scope: 'CZECH',
    homepageUrl: 'https://vlada.gov.cz/',
    adapter: 'RSS',
    feedUrl: 'https://vlada.gov.cz/cs/urad/RSS/rss.xml',
  },
  {
    key: 'global-reuters',
    name: 'Reuters',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.reuters.com/',
    adapter: 'GDELT',
    query: 'domain:reuters.com',
  },
  {
    key: 'global-ap',
    name: 'Associated Press (AP)',
    scope: 'GLOBAL',
    homepageUrl: 'https://apnews.com/',
    adapter: 'GDELT',
    query: 'domain:apnews.com',
  },
  {
    key: 'global-bbc',
    name: 'BBC News',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.bbc.com/news',
    adapter: 'RSS',
    feedUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
  },
  {
    key: 'global-guardian',
    name: 'The Guardian',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.theguardian.com/',
    adapter: 'RSS',
    feedUrl: 'https://www.theguardian.com/world/rss',
  },
  {
    key: 'global-al-jazeera',
    name: 'Al Jazeera English',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.aljazeera.com/',
    adapter: 'RSS',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
  },
  {
    key: 'global-npr',
    name: 'NPR',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.npr.org/',
    adapter: 'RSS',
    feedUrl: 'https://feeds.npr.org/1001/rss.xml',
  },
  {
    key: 'global-ft',
    name: 'Financial Times',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.ft.com/',
    adapter: 'RSS',
    feedUrl: 'https://www.ft.com/rss/home',
  },
  {
    key: 'global-bloomberg',
    name: 'Bloomberg',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.bloomberg.com/',
    adapter: 'RSS',
    feedUrl: 'https://feeds.bloomberg.com/markets/news.rss',
  },
  {
    key: 'global-economist',
    name: 'The Economist',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.economist.com/',
    adapter: 'RSS',
    feedUrl: 'https://www.economist.com/the-world-this-week/rss.xml',
  },
  {
    key: 'global-politico-europe',
    name: 'Politico Europe',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.politico.eu/',
    adapter: 'RSS',
    feedUrl: 'https://www.politico.eu/feed/',
  },
  {
    key: 'global-euractiv',
    name: 'Euractiv',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.euractiv.com/',
    adapter: 'GDELT',
    query: 'domain:euractiv.com',
  },
  {
    key: 'global-nature-news',
    name: 'Nature News',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.nature.com/news',
    adapter: 'RSS',
    feedUrl: 'https://www.nature.com/nature.rss',
  },
  {
    key: 'global-science',
    name: 'Science',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.science.org/',
    adapter: 'RSS',
    feedUrl:
      'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science',
  },
  {
    key: 'global-mit-technology-review',
    name: 'MIT Technology Review',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.technologyreview.com/',
    adapter: 'RSS',
    feedUrl: 'https://www.technologyreview.com/feed/',
  },
  {
    key: 'global-ars-technica',
    name: 'Ars Technica',
    scope: 'GLOBAL',
    homepageUrl: 'https://arstechnica.com/',
    adapter: 'RSS',
    feedUrl: 'https://feeds.arstechnica.com/arstechnica/index',
  },
  {
    key: 'global-who',
    name: 'WHO',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.who.int/',
    adapter: 'RSS',
    feedUrl: 'https://www.who.int/rss-feeds/news-english.xml',
  },
  {
    key: 'global-european-commission',
    name: 'European Commission',
    scope: 'GLOBAL',
    homepageUrl: 'https://commission.europa.eu/',
    adapter: 'RSS',
    feedUrl: 'https://ec.europa.eu/commission/presscorner/api/rss?language=en',
  },
  {
    key: 'global-ecb',
    name: 'ECB',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.ecb.europa.eu/',
    adapter: 'RSS',
    feedUrl: 'https://www.ecb.europa.eu/rss/press.html',
  },
  {
    key: 'global-nasa',
    name: 'NASA',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.nasa.gov/',
    adapter: 'RSS',
    feedUrl: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  },
  {
    key: 'global-esa',
    name: 'ESA',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.esa.int/',
    adapter: 'RSS',
    feedUrl: 'https://www.esa.int/rssfeed/Our_Activities',
  },
  {
    key: 'global-iea',
    name: 'IEA',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.iea.org/',
    adapter: 'GDELT',
    query: 'domain:iea.org',
  },
  {
    key: 'global-gdelt',
    name: 'GDELT',
    scope: 'GLOBAL',
    homepageUrl: 'https://www.gdeltproject.org/',
    adapter: 'GDELT',
    query:
      '(conflict OR economy OR politics OR climate OR health OR science OR technology)',
  },
] as const satisfies readonly BuiltInNewsSource[];

const byKey = new Map<string, BuiltInNewsSource>(
  builtInNewsSources.map((source) => [source.key, source]),
);

export const getBuiltInNewsSource = (
  key: string,
): BuiltInNewsSource | undefined => byKey.get(key);

export const builtInNewsSourceUrl = (source: BuiltInNewsSource): string =>
  source.adapter === 'RSS' ? source.feedUrl : source.homepageUrl;
