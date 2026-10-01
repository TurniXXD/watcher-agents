import { fetchPublicHtml } from '@watcher/sources';
import type { Collector, EntityRef } from './types.js';

const decode = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/gu, ' ')
    .trim();

const meta = (html: string, name: string): string | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      'iu',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
      'iu',
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decode(match);
  }
  return undefined;
};

const title = (html: string): string | undefined => {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return value ? decode(value.replace(/<[^>]+>/gu, ' ')) : undefined;
};

const profileUrl = (type: string, value: string): string => {
  if (type === 'LINKEDIN_PUBLIC_PROFILE_URL' || type === 'YOUTUBE_CHANNEL')
    return value;
  if (type === 'TWITTER_USERNAME')
    return `https://x.com/${encodeURIComponent(value.replace(/^@/u, ''))}`;
  throw new Error('Unsupported public profile selector');
};

export const createPublicProfileMetadataCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'PUBLIC_PROFILE_METADATA',
  supports: [
    'LINKEDIN_PUBLIC_PROFILE_URL',
    'TWITTER_USERNAME',
    'YOUTUBE_CHANNEL',
  ],
  priority: 40,
  collect: async (selector, signal) => {
    const url = profileUrl(selector.type, selector.value);
    const response = await fetchPublicHtml(url, {
      fetcher,
      signal,
      maximumBytes: 1_000_000,
      timeoutMs: 20_000,
      userAgent: 'Watcher OSINT/1.0 (public research)',
    });
    const pageTitle = meta(response.html, 'og:title') ?? title(response.html);
    const description =
      meta(response.html, 'og:description') ??
      meta(response.html, 'description');
    if (!pageTitle && !description) return [];
    const entity: EntityRef = {
      kind: 'PUBLIC_PROFILE',
      key: `${selector.type.toLowerCase()}:${selector.value.toLowerCase()}`,
      label: pageTitle ?? selector.value,
    };
    return [
      {
        sourceKey: `public-profile:${selector.type.toLowerCase()}:${selector.value.toLowerCase()}`,
        sourceUrl: response.url,
        excerpt:
          `${pageTitle ?? selector.value}${description ? ` · ${description}` : ''} · veřejná metadata profilu; shoda jména nebo handle sama nepotvrzuje totožnost`.slice(
            0,
            900,
          ),
        data: {
          selectorType: selector.type,
          query: selector.value,
          title: pageTitle ?? null,
          description: description ?? null,
          resolvedUrl: response.url,
        },
        findings: [
          {
            entity,
            predicate: 'PUBLIC_PROFILE_URL',
            value: response.url,
          },
          ...(pageTitle
            ? [
                {
                  entity,
                  predicate: 'PUBLIC_PROFILE_TITLE',
                  value: pageTitle,
                },
              ]
            : []),
        ],
        links: [],
      },
    ];
  },
});

export const createPublicEmailEvidenceCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'PUBLIC_WEBSITE_EMAIL_EVIDENCE',
  supports: ['EMAIL'],
  priority: 35,
  collect: async (selector, signal) => {
    const domain = selector.value.split('@')[1];
    if (!domain) return [];
    const response = await fetchPublicHtml(`https://${domain}/`, {
      fetcher,
      signal,
      maximumBytes: 1_000_000,
      timeoutMs: 20_000,
      userAgent: 'Watcher OSINT/1.0 (public research)',
    });
    if (!response.html.toLowerCase().includes(selector.value.toLowerCase()))
      return [];
    const entity: EntityRef = {
      kind: 'DOMAIN',
      key: `domain:${domain}`,
      label: domain,
    };
    return [
      {
        sourceKey: `public-email:${selector.value}:${response.url}`,
        sourceUrl: response.url,
        excerpt: `Adresa ${selector.value} byla nalezena na veřejné stránce ${response.url}; zveřejnění samo nepotvrzuje vlastníka ani oprávnění ke kontaktování.`,
        data: {
          email: selector.value,
          domain,
          pageUrl: response.url,
        },
        findings: [
          {
            entity,
            predicate: 'PUBLICLY_LISTED_EMAIL',
            value: selector.value,
          },
        ],
        links: [],
      },
    ];
  },
});
