import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { fetchJobSource, responseCheckpoint } from './http.js';
import {
  canonicalizeUrl,
  cleanHtml,
  extractTechnologyStack,
} from './normalization.js';
import { parseSchemaJobPostingPage } from './schema-jobposting.js';
import {
  normalizedJobSchema,
  type JobSourceAdapter,
  type NormalizedJob,
} from './types.js';

const htmlAccept = 'text/html,application/xhtml+xml';
const sitemapAccept = 'application/xml,text/xml';
const maximumSitemapJobs = 250;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

const textValue = (value: string): string => value.replace(/\s+/gu, ' ').trim();

const optionalDate = (value: string | number | undefined): Date | undefined => {
  if (value === undefined) return undefined;
  const date = new Date(typeof value === 'number' ? value * 1_000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const sourceOwnedUrl = (
  value: string,
  hostnames: readonly string[],
  base?: string,
): URL | undefined => {
  try {
    const url = new URL(value, base);
    return hostnames.includes(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
};

const inferWorkMode = (
  location: string | undefined,
  value: string,
): NormalizedJob['workMode'] => {
  const text = `${location ?? ''} ${value}`;
  if (
    /\b(?:remote|worldwide|anywhere|odkudkoliv)\b|100\s*%\s*home office|home office\s*:?\s*100\s*%/iu.test(
      text,
    )
  )
    return 'REMOTE';
  if (/\b(?:hybrid|home[ -]?office|kombinovan|částečně remote)\b/iu.test(text))
    return 'HYBRID';
  return location ? 'ONSITE' : 'UNKNOWN';
};

const listingJob = (input: {
  externalId: string;
  sourceId: string;
  title: string;
  company?: string;
  location?: string;
  description?: string;
  url: string;
  publishedAt?: Date;
  raw?: unknown;
}): NormalizedJob => {
  const description = textValue(input.description ?? input.title);
  const originalUrl = canonicalizeUrl(input.url);
  return normalizedJobSchema.parse({
    externalId: input.externalId,
    sourceId: input.sourceId,
    title: textValue(input.title),
    company: textValue(input.company ?? 'Undisclosed employer'),
    description,
    shortDescription: description.slice(0, 500),
    ...(input.location ? { location: textValue(input.location) } : {}),
    workMode: inferWorkMode(input.location, description),
    remoteRegions: [],
    technologyStack: extractTechnologyStack(`${input.title} ${description}`),
    originalUrl,
    canonicalApplicationUrl: originalUrl,
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    raw: input.raw ?? { listingUrl: originalUrl },
  });
};

const uniqueJobs = (jobs: NormalizedJob[]): NormalizedJob[] => [
  ...new Map(jobs.map((job) => [job.externalId, job])).values(),
];

const wait = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('Czech job source request was aborted'),
        );
      },
      { once: true },
    );
  });

const rateLimitedDetail = (
  parser: (html: string, listing: NormalizedJob) => NormalizedJob,
  minimumIntervalMs = 1_000,
) => {
  let lastStartedAt = 0;
  return async (
    job: NormalizedJob,
    { signal }: { signal?: AbortSignal },
  ): Promise<NormalizedJob> => {
    const remaining = lastStartedAt + minimumIntervalMs - Date.now();
    if (remaining > 0) await wait(remaining, signal);
    lastStartedAt = Date.now();
    const response = await fetchJobSource(job.originalUrl, {
      accept: htmlAccept,
      ...(signal ? { signal } : {}),
    });
    return parser(await response.text(), job);
  };
};

const categoryAdapter = (input: {
  id: string;
  name: string;
  baseUrl: string;
  urls: string[];
  parse: (html: string) => NormalizedJob[];
  detail: (html: string, listing: NormalizedJob) => NormalizedJob;
}): JobSourceAdapter => ({
  id: input.id,
  name: input.name,
  baseUrl: input.baseUrl,
  strategy: 'HTML',
  attribution: `Jobs by ${input.name}`,
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 30,
  discover: async ({ signal }) => {
    const results = await Promise.allSettled(
      input.urls.map(async (url) => {
        const response = await fetchJobSource(url, {
          accept: htmlAccept,
          ...(signal ? { signal } : {}),
        });
        return input.parse(await response.text());
      }),
    );
    const jobs = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    if (jobs.length === 0) {
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (rejected) throw rejected.reason;
      throw new Error(`${input.name} public listings contained no valid jobs`);
    }
    return { jobs: uniqueJobs(jobs) };
  },
  fetchDetail: rateLimitedDetail(input.detail),
});

export const jobsCzDiscoveryUrls = [
  'https://www.jobs.cz/prace/is-it-vyvoj-aplikaci-a-systemu/',
  'https://www.jobs.cz/prace/is-it-konzultace-analyzy-a-projektove-rizeni/',
  'https://www.jobs.cz/prace/is-it-sprava-systemu-a-hw/',
  'https://www.jobs.cz/prace/brno/account-manager/',
  'https://www.jobs.cz/prace/obchodni-zastupce/',
] as const;

export const praceCzDiscoveryUrls = [
  'programator',
  'tester',
  'projektovy-manazer',
  'obchodni-zastupce',
  'account-manager',
].map((profession) => `https://www.prace.cz/nabidky/${profession}/`);

export const praceZaRohemDiscoveryUrls = [
  'https://www.pracezarohem.cz/nabidky/is-it-vyvoj-aplikaci-a-systemu',
  'https://www.pracezarohem.cz/nabidky/is-it-konzultace-analyzy-a-projektove-rizeni',
  'https://www.pracezarohem.cz/nabidky/is-it-sprava-systemu-a-hw',
  'https://www.pracezarohem.cz/nabidky/jihomoravsky/brno-mesto/prodej-a-obchod',
] as const;

export const parseJobsCzListings = (html: string): NormalizedJob[] => {
  const $ = load(html);
  const jobs: NormalizedJob[] = [];
  $('article.SearchResultCard').each((_, element) => {
    const card = $(element);
    const anchor = card.find('a[href*="/rpd/"]').first();
    const href = anchor.attr('href');
    const match = href?.match(/\/rpd\/(\d+)/u);
    const title = textValue(anchor.text());
    if (!match?.[1] || !title) return;
    const company = textValue(
      card
        .find('footer [translate="no"], footer .SearchResultCard__footerItem')
        .first()
        .text(),
    );
    const location = textValue(
      card.find('[data-test="serp-locality"]').first().text(),
    );
    jobs.push(
      listingJob({
        externalId: match[1],
        sourceId: 'jobs-cz',
        title,
        ...(company ? { company } : {}),
        ...(location ? { location } : {}),
        url: `https://www.jobs.cz/rpd/${match[1]}/`,
        raw: { href },
      }),
    );
  });
  return uniqueJobs(jobs);
};

export const parseJobsCzDetail = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob => {
  const $ = load(html);
  const title =
    textValue($('meta[property="og:title"]').attr('content') ?? '') ||
    listing.title;
  const description = textValue(
    `${$('meta[name="description"]').attr('content') ?? ''} ${$('main').text()}`,
  );
  return normalizedJobSchema.parse({
    ...listing,
    title,
    description: description || listing.description,
    shortDescription: (description || listing.description).slice(0, 500),
    workMode: inferWorkMode(listing.location, description),
    technologyStack: extractTechnologyStack(`${title} ${description}`),
    raw: { listing: listing.raw, detailTitle: title },
  });
};

export const createJobsCzAdapter = (): JobSourceAdapter =>
  categoryAdapter({
    id: 'jobs-cz',
    name: 'Jobs.cz',
    baseUrl: 'https://www.jobs.cz',
    urls: [...jobsCzDiscoveryUrls],
    parse: parseJobsCzListings,
    detail: parseJobsCzDetail,
  });

export const parsePraceCzListings = (html: string): NormalizedJob[] => {
  const $ = load(html);
  const jobs: NormalizedJob[] = [];
  $('a[href*="/nabidka/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    const match = href?.match(/\/nabidka\/([0-9a-f-]{20,})/iu);
    if (!match?.[1]) return;
    const url = sourceOwnedUrl(
      href!,
      ['prace.cz', 'www.prace.cz'],
      'https://www.prace.cz',
    );
    if (!url) return;
    const title = textValue(anchor.attr('title') ?? anchor.text());
    if (!title || title.length > 180) return;
    const card = anchor.closest('article, li');
    const company = textValue(
      card.find('[translate="no"], [class*="company"]').first().text(),
    );
    const location = textValue(
      card.find('[class*="locality"], [class*="location"]').first().text(),
    );
    jobs.push(
      listingJob({
        externalId: match[1],
        sourceId: 'prace-cz',
        title,
        ...(company ? { company } : {}),
        ...(location ? { location } : {}),
        url: url.toString(),
        raw: { href },
      }),
    );
  });
  return uniqueJobs(jobs);
};

export const createPraceCzAdapter = (): JobSourceAdapter =>
  categoryAdapter({
    id: 'prace-cz',
    name: 'Prace.cz',
    baseUrl: 'https://www.prace.cz',
    urls: praceCzDiscoveryUrls,
    parse: parsePraceCzListings,
    detail: (html, listing) =>
      parseSchemaJobPostingPage({ html, listing, sourceId: 'prace-cz' }),
  });

const pzrListingSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().trim().min(1),
    company: z.string().trim().min(1),
    valid: z.boolean().optional(),
    validStart: z.number().optional(),
    location: z
      .object({
        place: z.string().optional(),
        placeDetail: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const nextData = (html: string): unknown => {
  const $ = load(html);
  const raw = $('script#__NEXT_DATA__').text();
  if (!raw) throw new Error('Page does not contain Next.js data');
  return JSON.parse(raw);
};

export const parsePraceZaRohemListings = (html: string): NormalizedJob[] => {
  const document = z
    .object({
      props: z.object({
        pageProps: z.object({
          adverts: z.object({ adverts: z.array(z.unknown()) }),
        }),
      }),
    })
    .parse(nextData(html));
  return document.props.pageProps.adverts.adverts.flatMap((value) => {
    const parsed = pzrListingSchema.safeParse(value);
    if (!parsed.success || parsed.data.valid === false) return [];
    const location = [
      parsed.data.location?.place,
      parsed.data.location?.placeDetail,
    ]
      .filter(Boolean)
      .join(', ');
    const publishedAt = optionalDate(parsed.data.validStart);
    return [
      listingJob({
        externalId: parsed.data.id,
        sourceId: 'prace-za-rohem',
        title: parsed.data.title,
        company: parsed.data.company,
        ...(location ? { location } : {}),
        url: `https://www.pracezarohem.cz/dl/jd/${encodeURIComponent(parsed.data.id)}`,
        ...(publishedAt ? { publishedAt } : {}),
        raw: parsed.data,
      }),
    ];
  });
};

const pzrDetailSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().trim().min(1),
    company: z.string().trim().min(1),
    valid: z.boolean().optional(),
    validSince: z
      .union([z.number(), z.record(z.string(), z.unknown())])
      .optional(),
    desc: z.string().optional(),
    webUrl: z.url().optional(),
    location: z
      .object({ label: z.string().optional() })
      .passthrough()
      .optional(),
    locations: z
      .array(z.object({ label: z.string().optional() }).passthrough())
      .optional(),
    descFields: z
      .object({
        jobProperties: z
          .array(
            z
              .object({
                label: z.string().optional(),
                value: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
        jobText: z
          .array(z.object({ value: z.string().optional() }).passthrough())
          .optional(),
        companyText: z
          .array(z.object({ value: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const parsePraceZaRohemDetail = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob => {
  const document = z
    .object({
      props: z.object({ pageProps: z.object({ advert: z.unknown() }) }),
    })
    .parse(nextData(html));
  const advert = pzrDetailSchema.parse(document.props.pageProps.advert);
  const description = cleanHtml(
    [
      advert.desc,
      ...(advert.descFields?.jobText ?? []).map(({ value }) => value ?? ''),
      ...(advert.descFields?.jobProperties ?? []).map(
        ({ label, value }) => `${label ?? ''}: ${value ?? ''}`,
      ),
    ].join(' '),
  );
  const location =
    advert.location?.label ??
    advert.locations
      ?.map(({ label }) => label)
      .filter(Boolean)
      .join(', ') ??
    listing.location;
  const originalUrl = canonicalizeUrl(listing.originalUrl);
  const publishedAt =
    typeof advert.validSince === 'number'
      ? optionalDate(advert.validSince)
      : undefined;
  return normalizedJobSchema.parse({
    externalId: advert.id,
    sourceId: 'prace-za-rohem',
    title: advert.title,
    company: advert.company,
    description,
    shortDescription: description.slice(0, 500),
    ...(location ? { location } : {}),
    workMode: inferWorkMode(location, description),
    remoteRegions: [],
    technologyStack: extractTechnologyStack(`${advert.title} ${description}`),
    originalUrl,
    canonicalApplicationUrl: advert.webUrl
      ? canonicalizeUrl(advert.webUrl)
      : originalUrl,
    ...(publishedAt ? { publishedAt } : {}),
    raw: advert,
  });
};

export const createPraceZaRohemAdapter = (): JobSourceAdapter =>
  categoryAdapter({
    id: 'prace-za-rohem',
    name: 'Práce za rohem',
    baseUrl: 'https://www.pracezarohem.cz',
    urls: [...praceZaRohemDiscoveryUrls],
    parse: parsePraceZaRohemListings,
    detail: parsePraceZaRohemDetail,
  });

const sitemapDocumentSchema = z.record(z.string(), z.unknown());

const sitemapEntries = (
  xml: string,
): Array<{ loc: string; lastmod?: string }> => {
  const document = sitemapDocumentSchema.parse(xmlParser.parse(xml));
  const urlset = z.record(z.string(), z.unknown()).parse(document.urlset);
  const raw = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
  return raw.flatMap((value) => {
    const parsed = z
      .object({ loc: z.string(), lastmod: z.string().optional() })
      .safeParse(value);
    return parsed.success
      ? [
          {
            loc: parsed.data.loc,
            ...(parsed.data.lastmod ? { lastmod: parsed.data.lastmod } : {}),
          },
        ]
      : [];
  });
};

const sitemapAdapter = (input: {
  id: string;
  name: string;
  baseUrl: string;
  sitemapUrl: string;
  listing: (entry: {
    loc: string;
    lastmod?: string;
  }) => NormalizedJob | undefined;
  detail: (html: string, listing: NormalizedJob) => NormalizedJob;
}): JobSourceAdapter => ({
  id: input.id,
  name: input.name,
  baseUrl: input.baseUrl,
  strategy: 'SITEMAP',
  attribution: `Jobs by ${input.name}`,
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 30,
  discover: async ({ checkpoint, signal }) => {
    const response = await fetchJobSource(input.sitemapUrl, {
      accept: sitemapAccept,
      ...(checkpoint ? { checkpoint } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 304)
      return {
        jobs: [],
        notModified: true,
        ...(checkpoint ? { checkpoint } : {}),
      };
    const jobs = sitemapEntries(await response.text())
      .sort((left, right) =>
        (left.lastmod ?? '').localeCompare(right.lastmod ?? ''),
      )
      .flatMap((entry) => {
        const job = input.listing(entry);
        return job ? [job] : [];
      })
      .slice(-maximumSitemapJobs);
    if (jobs.length === 0)
      throw new Error(`${input.name} sitemap contained no valid job URLs`);
    return {
      jobs,
      checkpoint: responseCheckpoint(response),
    };
  },
  fetchDetail: rateLimitedDetail(input.detail),
});

const slugTitle = (slug: string): string =>
  decodeURIComponent(slug).replaceAll('-', ' ').replace(/\s+/gu, ' ').trim();

const genericHtmlDetail = (input: {
  html: string;
  listing: NormalizedJob;
  sourceId: string;
  titleSelector: string;
  companySelector: string;
  locationSelector?: string;
  descriptionSelector: string;
}): NormalizedJob => {
  const $ = load(input.html);
  const title =
    textValue($(input.titleSelector).first().text()) || input.listing.title;
  const company =
    textValue($(input.companySelector).first().text()) || input.listing.company;
  const location = input.locationSelector
    ? textValue($(input.locationSelector).first().text()) ||
      input.listing.location
    : input.listing.location;
  const description = cleanHtml($(input.descriptionSelector).text());
  return normalizedJobSchema.parse({
    ...input.listing,
    sourceId: input.sourceId,
    title,
    company,
    description: description || input.listing.description,
    shortDescription: (description || input.listing.description).slice(0, 500),
    ...(location ? { location } : {}),
    workMode: inferWorkMode(location, description),
    technologyStack: extractTechnologyStack(`${title} ${description}`),
    raw: { listing: input.listing.raw, pageTitle: title },
  });
};

export const createJenPraceAdapter = (): JobSourceAdapter =>
  sitemapAdapter({
    id: 'jenprace-cz',
    name: 'JenPrace.cz',
    baseUrl: 'https://www.jenprace.cz',
    sitemapUrl: 'https://www.jenprace.cz/sitemap/offers.xml',
    listing: ({ loc, lastmod }) => {
      const url = sourceOwnedUrl(loc, ['jenprace.cz', 'www.jenprace.cz']);
      if (!url) return undefined;
      const match = url.pathname.match(/^\/nabidka\/([^/]+)\/([^/]+)/u);
      const publishedAt = optionalDate(lastmod);
      return match?.[1] && match[2]
        ? listingJob({
            externalId: match[1],
            sourceId: 'jenprace-cz',
            title: slugTitle(match[2]),
            url: loc,
            ...(publishedAt ? { publishedAt } : {}),
          })
        : undefined;
    },
    detail: (html, listing) =>
      parseSchemaJobPostingPage({ html, listing, sourceId: 'jenprace-cz' }),
  });

export const createJobsiAdapter = (): JobSourceAdapter =>
  sitemapAdapter({
    id: 'jobsi-cz',
    name: 'Jobsi.cz',
    baseUrl: 'https://www.jobsi.cz',
    sitemapUrl: 'https://jobsi.cz/sitemap.xml',
    listing: ({ loc, lastmod }) => {
      const url = sourceOwnedUrl(loc, ['jobsi.cz', 'www.jobsi.cz']);
      if (!url) return undefined;
      const match = url.pathname.match(/^\/job\/(\d+)-([^/]+)/u);
      const publishedAt = optionalDate(lastmod);
      return match?.[1] && match[2]
        ? listingJob({
            externalId: match[1],
            sourceId: 'jobsi-cz',
            title: slugTitle(match[2]),
            url: loc,
            ...(publishedAt ? { publishedAt } : {}),
          })
        : undefined;
    },
    detail: parseJobsiDetail,
  });

export const parseJobsiDetail = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob =>
  genericHtmlDetail({
    html,
    listing,
    sourceId: 'jobsi-cz',
    titleSelector: '.job_detail h1, h1',
    companySelector: '.job_top_info .company, [class*="company"]',
    locationSelector: '.job_top_info .city, [class*="city"]',
    descriptionSelector: '.job_detail .bottom, .job_detail',
  });

export const createJobstackAdapter = (): JobSourceAdapter =>
  sitemapAdapter({
    id: 'jobstack-it',
    name: 'Jobstack.it',
    baseUrl: 'https://www.jobstack.it',
    sitemapUrl: 'https://www.jobstack.it/sitemap.xml',
    listing: ({ loc, lastmod }) => {
      const url = sourceOwnedUrl(loc, ['jobstack.it', 'www.jobstack.it']);
      if (!url) return undefined;
      const match = url.pathname.match(/^\/it-job\/([^/]+)\/([a-z0-9]+)/iu);
      const publishedAt = optionalDate(lastmod);
      return match?.[1] && match[2]
        ? listingJob({
            externalId: match[2],
            sourceId: 'jobstack-it',
            title: slugTitle(match[1]),
            url: loc,
            ...(publishedAt ? { publishedAt } : {}),
          })
        : undefined;
    },
    detail: parseJobstackDetail,
  });

export const parseJobstackDetail = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob => {
  const base = genericHtmlDetail({
    html,
    listing,
    sourceId: 'jobstack-it',
    titleSelector: 'h1',
    companySelector: 'a[href*="company-profile"]',
    descriptionSelector: '.wysiwyg-content, .jobpost-label-2023, .js-2023-h3',
  });
  const $ = load(html);
  const requirements = textValue(
    $('.jobpost-label-2023, .js-2023-h3')
      .toArray()
      .map((element) => $(element).parent().text())
      .join(' '),
  );
  const description = textValue(`${base.description} ${requirements}`);
  return normalizedJobSchema.parse({
    ...base,
    description,
    shortDescription: description.slice(0, 500),
    technologyStack: extractTechnologyStack(`${base.title} ${description}`),
  });
};

export const parseCoolJobsListings = (html: string): NormalizedJob[] => {
  const $ = load(html);
  const jobs: NormalizedJob[] = [];
  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    const match = href?.match(/(?:^|\/)([a-z0-9-]+)\/(\d+)\/?$/iu);
    const content = textValue(anchor.text());
    if (!match?.[1] || !match[2] || content.length < 5) return;
    const title = textValue(
      content
        .replace(/^#?\s*\d+\s*/u, '')
        .split(/Místo|Start|Smlouva|Home office|Měsíčně/iu)[0] ?? '',
    );
    if (!title) return;
    const location = content.match(
      /Místo\s*:?\s*(.+?)(?:Start|Smlouva|Home office|Měsíčně|$)/iu,
    )?.[1];
    jobs.push(
      listingJob({
        externalId: match[2],
        sourceId: 'cooljobs-eu',
        title,
        company: 'CoolPeople Czech s.r.o.',
        ...(location ? { location } : {}),
        description: content,
        url: `https://www.cooljobs.eu/cz/${match[1]}/${match[2]}`,
        raw: { href, content },
      }),
    );
  });
  return uniqueJobs(jobs);
};

export const parseCoolJobsDetail = (
  html: string,
  listing: NormalizedJob,
): NormalizedJob => {
  const $ = load(html);
  const title =
    textValue($('h1').first().text()).replace(/\s*\(\d+\)\s*$/u, '') ||
    listing.title;
  const description = textValue(
    $('meta[name="description"]').attr('content') ?? $('main').text(),
  );
  return normalizedJobSchema.parse({
    ...listing,
    title,
    description: description || listing.description,
    shortDescription: (description || listing.description).slice(0, 500),
    workMode: inferWorkMode(
      listing.location,
      `${listing.description} ${description}`,
    ),
    technologyStack: extractTechnologyStack(`${title} ${description}`),
    raw: { listing: listing.raw, pageTitle: title },
  });
};

export const createCoolJobsAdapter = (): JobSourceAdapter =>
  categoryAdapter({
    id: 'cooljobs-eu',
    name: 'CoolJobs.eu',
    baseUrl: 'https://www.cooljobs.eu',
    urls: ['https://www.cooljobs.eu/sk/hledat-pozici/1101.html'],
    parse: parseCoolJobsListings,
    detail: parseCoolJobsDetail,
  });
