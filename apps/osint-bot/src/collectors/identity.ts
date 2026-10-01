import { z } from 'zod';
import type { Collector, EntityRef } from './types.js';
import { fetchPublicJson, type PublicJsonOptions } from './public-json.js';

const githubSchema = z.object({
  login: z.string(),
  id: z.number().int(),
  html_url: z.string().url(),
  type: z.string().optional(),
  name: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  public_repos: z.number().int().optional(),
  followers: z.number().int().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createGithubCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'GITHUB_PUBLIC_PROFILE',
  supports: ['GITHUB_PROFILE', 'USERNAME'],
  priority: 65,
  collect: async (selector, signal) => {
    const username = selector.value.replace(/^@/u, '');
    const response = await fetchPublicJson(
      `https://api.github.com/users/${encodeURIComponent(username)}`,
      githubSchema,
      { ...options, signal, accept: 'application/vnd.github+json' },
    );
    const entity: EntityRef = {
      kind: 'PUBLIC_PROFILE',
      key: `github:${response.data.id}`,
      label: response.data.login,
    };
    const observedAt = response.data.updated_at
      ? new Date(response.data.updated_at)
      : undefined;
    return [
      {
        sourceKey: `github:user:${response.data.id}`,
        sourceUrl: response.data.html_url,
        excerpt:
          `GitHub @${response.data.login}${response.data.name ? ` · ${response.data.name}` : ''}${response.data.company ? ` · ${response.data.company}` : ''} · ${response.data.public_repos ?? 0} veřejných repozitářů. Shoda uživatelského jména sama nepotvrzuje totožnost.`.slice(
            0,
            900,
          ),
        data: {
          query: selector.value,
          login: response.data.login,
          githubId: response.data.id,
          type: response.data.type ?? null,
          publicName: response.data.name ?? null,
          company: response.data.company ?? null,
          blog: response.data.blog ?? null,
          bio: response.data.bio ?? null,
          publicRepositories: response.data.public_repos ?? null,
          followers: response.data.followers ?? null,
          createdAt: response.data.created_at ?? null,
          updatedAt: response.data.updated_at ?? null,
        },
        ...(observedAt && !Number.isNaN(observedAt.getTime())
          ? { observedAt }
          : {}),
        findings: [
          {
            entity,
            predicate: 'GITHUB_LOGIN',
            value: response.data.login,
          },
          ...(response.data.name
            ? [
                {
                  entity,
                  predicate: 'PUBLIC_DISPLAY_NAME',
                  value: response.data.name,
                },
              ]
            : []),
        ],
        links: [],
      },
    ];
  },
});

const redditSchema = z.object({
  data: z.object({
    name: z.string(),
    id: z.string(),
    created_utc: z.number().optional(),
    link_karma: z.number().int().optional(),
    comment_karma: z.number().int().optional(),
    is_employee: z.boolean().optional(),
  }),
});

export const createRedditCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'REDDIT_PUBLIC_PROFILE',
  supports: ['REDDIT_USERNAME', 'USERNAME'],
  priority: 55,
  collect: async (selector, signal) => {
    const username = selector.value.replace(/^u\//u, '').replace(/^@/u, '');
    const response = await fetchPublicJson(
      `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`,
      redditSchema,
      { ...options, signal },
    );
    const entity: EntityRef = {
      kind: 'PUBLIC_PROFILE',
      key: `reddit:${response.data.data.id}`,
      label: `u/${response.data.data.name}`,
    };
    const observedAt = response.data.data.created_utc
      ? new Date(response.data.data.created_utc * 1000)
      : undefined;
    return [
      {
        sourceKey: `reddit:user:${response.data.data.id}`,
        sourceUrl: `https://www.reddit.com/user/${encodeURIComponent(response.data.data.name)}/`,
        excerpt: `Reddit u/${response.data.data.name} · link karma ${response.data.data.link_karma ?? 0} · comment karma ${response.data.data.comment_karma ?? 0}. Shoda uživatelského jména sama nepotvrzuje totožnost.`,
        data: {
          query: selector.value,
          username: response.data.data.name,
          redditId: response.data.data.id,
          createdUtc: response.data.data.created_utc ?? null,
          linkKarma: response.data.data.link_karma ?? null,
          commentKarma: response.data.data.comment_karma ?? null,
          employee: response.data.data.is_employee ?? null,
        },
        ...(observedAt ? { observedAt } : {}),
        findings: [
          {
            entity,
            predicate: 'REDDIT_USERNAME',
            value: response.data.data.name,
          },
        ],
        links: [],
      },
    ];
  },
});

const orcidSchema = z.object({
  name: z
    .object({
      'given-names': z.object({ value: z.string() }).nullable().optional(),
      'family-name': z.object({ value: z.string() }).nullable().optional(),
      'credit-name': z.object({ value: z.string() }).nullable().optional(),
    })
    .nullable()
    .optional(),
  biography: z
    .object({ content: z.string().nullable().optional() })
    .nullable()
    .optional(),
  'researcher-urls': z
    .object({
      'researcher-url': z
        .array(
          z.object({
            'url-name': z.string().nullable().optional(),
            url: z.object({ value: z.string() }).nullable().optional(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
});

export const createOrcidCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'ORCID_PUBLIC_RECORD',
  supports: ['ORCID'],
  priority: 90,
  collect: async (selector, signal) => {
    const response = await fetchPublicJson(
      `https://pub.orcid.org/v3.0/${encodeURIComponent(selector.value)}/person`,
      orcidSchema,
      { ...options, signal, accept: 'application/vnd.orcid+json' },
    );
    const name =
      response.data.name?.['credit-name']?.value ??
      [
        response.data.name?.['given-names']?.value,
        response.data.name?.['family-name']?.value,
      ]
        .filter(Boolean)
        .join(' ');
    const urls = (response.data['researcher-urls']?.['researcher-url'] ?? [])
      .map((item) => item.url?.value)
      .filter((item): item is string => Boolean(item))
      .slice(0, 10);
    const entity: EntityRef = {
      kind: 'PERSON',
      key: `orcid:${selector.value}`,
      label: name || selector.value,
    };
    return [
      {
        sourceKey: `orcid:person:${selector.value}`,
        sourceUrl: `https://orcid.org/${selector.value}`,
        excerpt:
          `ORCID ${selector.value}${name ? ` · ${name}` : ''}${urls.length ? ` · veřejné odkazy: ${urls.join(', ')}` : ''}`.slice(
            0,
            900,
          ),
        data: {
          orcid: selector.value,
          name: name || null,
          biography: response.data.biography?.content ?? null,
          publicUrls: urls.join(', ') || null,
        },
        findings: [
          { entity, predicate: 'ORCID', value: selector.value },
          ...(name ? [{ entity, predicate: 'PUBLIC_NAME', value: name }] : []),
        ],
        links: [],
      },
    ];
  },
});

const crossrefSchema = z.object({
  message: z.object({
    DOI: z.string(),
    URL: z.string().url().optional(),
    title: z.array(z.string()).optional(),
    publisher: z.string().optional(),
    type: z.string().optional(),
    author: z
      .array(
        z.object({
          given: z.string().optional(),
          family: z.string().optional(),
          ORCID: z.string().optional(),
        }),
      )
      .optional(),
    created: z.object({ 'date-time': z.string().optional() }).optional(),
  }),
});

export const createCrossrefCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'CROSSREF_DOI',
  supports: ['DOI'],
  priority: 90,
  collect: async (selector, signal) => {
    const response = await fetchPublicJson(
      `https://api.crossref.org/works/${encodeURIComponent(selector.value)}`,
      crossrefSchema,
      { ...options, signal },
    );
    const title = response.data.message.title?.[0] ?? selector.value;
    const authors = (response.data.message.author ?? [])
      .map((author) => [author.given, author.family].filter(Boolean).join(' '))
      .filter(Boolean)
      .slice(0, 30);
    const entity: EntityRef = {
      kind: 'DOCUMENT',
      key: `doi:${response.data.message.DOI.toLowerCase()}`,
      label: title,
    };
    const observedAt = response.data.message.created?.['date-time']
      ? new Date(response.data.message.created['date-time'])
      : undefined;
    return [
      {
        sourceKey: `crossref:doi:${response.data.message.DOI.toLowerCase()}`,
        sourceUrl:
          response.data.message.URL ??
          `https://doi.org/${response.data.message.DOI}`,
        excerpt:
          `${title} · DOI ${response.data.message.DOI}${authors.length ? ` · autoři ${authors.join(', ')}` : ''}${response.data.message.publisher ? ` · ${response.data.message.publisher}` : ''}`.slice(
            0,
            900,
          ),
        data: {
          doi: response.data.message.DOI,
          title,
          authors: authors.join(', ') || null,
          publisher: response.data.message.publisher ?? null,
          type: response.data.message.type ?? null,
        },
        ...(observedAt && !Number.isNaN(observedAt.getTime())
          ? { observedAt }
          : {}),
        findings: [
          { entity, predicate: 'DOI', value: response.data.message.DOI },
          { entity, predicate: 'TITLE', value: title },
          ...(authors.length
            ? [
                {
                  entity,
                  predicate: 'PUBLIC_AUTHOR_LIST',
                  value: authors.join(', '),
                },
              ]
            : []),
        ],
        links: [],
      },
    ];
  },
});

const wikipediaSchema = z.object({
  query: z
    .object({
      search: z
        .array(
          z.object({
            pageid: z.number().int(),
            title: z.string(),
            snippet: z.string(),
            timestamp: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replace(/\s+/gu, ' ')
    .trim();

export const createWikipediaCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'WIKIPEDIA_SEARCH',
  supports: ['FULL_NAME', 'COMPANY_NAME'],
  priority: 50,
  collect: async (selector, signal) => {
    const url = new URL('https://cs.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('utf8', '1');
    url.searchParams.set('srlimit', '5');
    url.searchParams.set('srsearch', selector.value);
    const response = await fetchPublicJson(url.toString(), wikipediaSchema, {
      ...options,
      signal,
    });
    return (response.data.query?.search ?? []).map((result) => {
      const observedAt = result.timestamp
        ? new Date(result.timestamp)
        : undefined;
      const entity: EntityRef = {
        kind: selector.type === 'FULL_NAME' ? 'PERSON' : 'ORGANIZATION',
        key: `wikipedia-search:${selector.type.toLowerCase()}:${selector.value.toLocaleLowerCase('cs')}`,
        label: selector.value,
      };
      return {
        sourceKey: `wikipedia:page:${result.pageid}`,
        sourceUrl: `https://cs.wikipedia.org/?curid=${result.pageid}`,
        excerpt:
          `${result.title} · ${stripHtml(result.snippet)} · kandidát z vyhledávání Wikipedie; shoda názvu sama nepotvrzuje totožnost`.slice(
            0,
            900,
          ),
        data: {
          query: selector.value,
          pageId: result.pageid,
          title: result.title,
          snippet: stripHtml(result.snippet),
        },
        ...(observedAt && !Number.isNaN(observedAt.getTime())
          ? { observedAt }
          : {}),
        findings: [
          {
            entity,
            predicate: 'WIKIPEDIA_SEARCH_CANDIDATE',
            value: `${result.pageid}: ${result.title}`,
          },
        ],
        links: [],
      };
    });
  },
});
