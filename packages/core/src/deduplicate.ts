import { createHash } from 'node:crypto';
import type { WatchItem } from './types.js';

export const contentHash = (content: string): string =>
  createHash('sha256').update(content.trim()).digest('hex');

export const itemIdentity = (item: WatchItem): string =>
  `${item.source}\u0000${item.externalId}`;

export const deduplicateItems = (items: WatchItem[]): WatchItem[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const identity = itemIdentity(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};
