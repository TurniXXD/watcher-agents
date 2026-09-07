import { normalizeInstagramUsername } from '../instagram/normalizer.js';
import { extractHtmlLinks } from './html.js';

export type DiscoveredSourceKind =
  'WEBSITE' | 'INSTAGRAM' | 'FACEBOOK' | 'RSS' | 'CALENDAR' | 'LINKTREE';

export type DiscoveredSourceLink = {
  type: DiscoveredSourceKind;
  url: string;
  username?: string;
};

export type SourceDiscoveryOptions = {
  excludeHostnames?: readonly string[];
};

const matchesHostname = (hostname: string, expected: string): boolean =>
  hostname === expected || hostname.endsWith(`.${expected}`);

const typeFor = (url: URL): DiscoveredSourceKind => {
  const hostname = url.hostname.replace(/^www\./u, '').toLowerCase();
  if (matchesHostname(hostname, 'instagram.com')) return 'INSTAGRAM';
  if (
    matchesHostname(hostname, 'facebook.com') ||
    matchesHostname(hostname, 'fb.me')
  )
    return 'FACEBOOK';
  if (matchesHostname(hostname, 'linktr.ee')) return 'LINKTREE';
  if (/\.(?:rss|xml)$/iu.test(url.pathname) || /feed|rss/iu.test(url.pathname))
    return 'RSS';
  if (/calendar|ical|ics/iu.test(url.pathname)) return 'CALENDAR';
  return 'WEBSITE';
};

export const discoverSourceLinks = (
  html: string,
  baseUrl: string,
  options: SourceDiscoveryOptions = {},
): DiscoveredSourceLink[] => {
  const excluded = (options.excludeHostnames ?? []).map((hostname) =>
    hostname.replace(/^www\./u, '').toLowerCase(),
  );
  const sources = new Map<string, DiscoveredSourceLink>();
  for (const link of extractHtmlLinks(html, baseUrl)) {
    const url = new URL(link.url);
    const hostname = url.hostname.replace(/^www\./u, '').toLowerCase();
    if (excluded.some((entry) => matchesHostname(hostname, entry))) continue;
    const type = typeFor(url);
    const username =
      type === 'INSTAGRAM'
        ? normalizeInstagramUsername(url.toString())
        : undefined;
    const canonical = username
      ? `https://www.instagram.com/${username}/`
      : url.toString();
    sources.set(canonical, {
      type,
      url: canonical,
      ...(username ? { username } : {}),
    });
  }
  return [...sources.values()];
};
