import { createHash } from 'node:crypto';
import type { InstagramPost } from './types.js';

const usernamePattern = /^[a-z0-9._]{1,30}$/u;

export const normalizeInstagramUsername = (value: string): string => {
  const trimmed = value.trim();
  let candidate = trimmed.replace(/^@/u, '');
  if (/^https?:\/\//iu.test(trimmed)) {
    const url = new URL(trimmed);
    if (!/(^|\.)instagram\.com$/iu.test(url.hostname)) {
      throw new Error('Expected an Instagram URL');
    }
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  candidate = candidate.toLowerCase();
  if (!usernamePattern.test(candidate)) {
    throw new Error('Invalid Instagram username');
  }
  return candidate;
};

export const instagramProfileUrl = (username: string): string =>
  `https://www.instagram.com/${normalizeInstagramUsername(username)}/`;

export const normalizeCaption = (caption: string | undefined): string =>
  (caption ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();

export const instagramPostFingerprint = (
  username: string,
  post: Pick<InstagramPost, 'id' | 'shortcode' | 'url' | 'caption'>,
): string => {
  const stableId = post.shortcode || post.id;
  const identity = stableId
    ? `${normalizeInstagramUsername(username)}\0${stableId}`
    : `${normalizeInstagramUsername(username)}\0${post.url}\0${normalizeCaption(post.caption)}`;
  return createHash('sha256').update(identity).digest('hex');
};

export const deduplicateInstagramPosts = (
  posts: readonly InstagramPost[],
): InstagramPost[] => {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const key = instagramPostFingerprint(post.account.username, post);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
