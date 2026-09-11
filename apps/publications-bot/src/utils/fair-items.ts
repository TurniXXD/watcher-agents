import { createHash } from 'node:crypto';
import type { WatchItem } from '@watcher/core';

const targetFor = (item: WatchItem): string => {
  const target = item.metadata.target;
  return typeof target === 'string' && target.trim()
    ? target.trim()
    : '__unknown_target__';
};

const targetRank = (runId: string, target: string): string =>
  createHash('sha256').update(`${runId}\u0000${target}`).digest('hex');

const newestFirst = (left: WatchItem, right: WatchItem): number =>
  (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0);

export const fairlyOrderPublicationItems = (
  items: WatchItem[],
  runId: string,
): WatchItem[] => {
  const grouped = new Map<string, WatchItem[]>();
  for (const item of items) {
    const target = targetFor(item);
    const group = grouped.get(target) ?? [];
    group.push(item);
    grouped.set(target, group);
  }
  const queues = [...grouped.entries()]
    .sort(([left], [right]) =>
      targetRank(runId, left).localeCompare(targetRank(runId, right)),
    )
    .map(([, group]) => group.sort(newestFirst));
  const ordered: WatchItem[] = [];
  for (let index = 0; ; index += 1) {
    let added = false;
    for (const queue of queues) {
      const item = queue[index];
      if (!item) continue;
      ordered.push(item);
      added = true;
    }
    if (!added) return ordered;
  }
};
