import { instagramProfileUrl, normalizeCaption } from './normalizer.js';
import type { InstagramPost, InstagramProfile } from './types.js';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const decodeHtml = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

const meta = (html: string, property: string): string | undefined => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const first = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      'iu',
    ),
  )?.[1];
  const second = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
      'iu',
    ),
  )?.[1];
  return first || second ? decodeHtml((first ?? second)!) : undefined;
};

const jsonScripts = (html: string): unknown[] =>
  [
    ...html.matchAll(
      /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/giu,
    ),
  ].flatMap((match) => {
    try {
      return [JSON.parse(decodeHtml(match[1] ?? '')) as unknown];
    } catch {
      return [];
    }
  });

const walk = (value: unknown, visit: (node: JsonRecord) => void): void => {
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, visit));
    return;
  }
  const node = record(value);
  if (!node) return;
  visit(node);
  Object.values(node).forEach((entry) => walk(entry, visit));
};

const captionFromNode = (node: JsonRecord): string | undefined => {
  const direct = text(node.caption) ?? text(node.text);
  if (direct) return normalizeCaption(direct);
  const edges = record(node.edge_media_to_caption)?.edges;
  if (!Array.isArray(edges)) return undefined;
  return normalizeCaption(text(record(record(edges[0])?.node)?.text));
};

const mediaType = (
  node: JsonRecord,
): NonNullable<InstagramPost['mediaType']> => {
  const typename = text(node.__typename)?.toLowerCase() ?? '';
  if (typename.includes('sidecar')) return 'carousel';
  if (typename.includes('video') || node.is_video === true) return 'video';
  if (typename.includes('reel')) return 'reel';
  if (typename.includes('image')) return 'image';
  return 'unknown';
};

export const parseInstagramHtml = (
  username: string,
  html: string,
): { profile: InstagramProfile; posts: InstagramPost[]; private: boolean } => {
  const profiles: JsonRecord[] = [];
  const postNodes: JsonRecord[] = [];
  for (const root of jsonScripts(html)) {
    walk(root, (node) => {
      if (
        node.is_private === true ||
        text(node.username)?.toLowerCase() === username
      )
        profiles.push(node);
      if (
        text(node.shortcode) &&
        (node.taken_at_timestamp ||
          node.taken_at ||
          node.edge_media_to_caption ||
          node.caption)
      ) {
        postNodes.push(node);
      }
    });
  }
  const profileNode =
    profiles.find((node) => text(node.username)?.toLowerCase() === username) ??
    profiles[0];
  const displayName =
    text(profileNode?.full_name) ??
    meta(html, 'og:title')?.split('(')[0]?.trim();
  const biography =
    text(profileNode?.biography) ?? meta(html, 'og:description');
  const externalLinks: Array<{ title?: string; url: string }> = [];
  const bioLinks = profileNode?.bio_links;
  if (Array.isArray(bioLinks)) {
    for (const link of bioLinks) {
      const item = record(link);
      const url = text(item?.url) ?? text(item?.lynx_url);
      const title = text(item?.title);
      if (url && /^https?:\/\//iu.test(url))
        externalLinks.push({ ...(title ? { title } : {}), url });
    }
  }
  const posts = postNodes.flatMap((node): InstagramPost[] => {
    const shortcode = text(node.shortcode);
    const id = text(node.id) ?? shortcode;
    if (!id || !shortcode) return [];
    const timestamp = number(node.taken_at_timestamp) ?? number(node.taken_at);
    const imageUrl = text(node.display_url) ?? text(node.thumbnail_src);
    const caption = captionFromNode(node);
    return [
      {
        id,
        shortcode,
        account: { username, ...(displayName ? { displayName } : {}) },
        ...(caption ? { caption } : {}),
        ...(timestamp ? { publishedAt: new Date(timestamp * 1_000) } : {}),
        url: `https://www.instagram.com/p/${shortcode}/`,
        mediaType: mediaType(node),
        ...(imageUrl ? { imageUrl } : {}),
        raw: node,
      },
    ];
  });
  return {
    profile: {
      username,
      ...(displayName ? { displayName } : {}),
      ...(biography ? { biography } : {}),
      profileUrl: instagramProfileUrl(username),
      ...(externalLinks.length ? { externalLinks } : {}),
    },
    posts,
    private: profileNode?.is_private === true,
  };
};
