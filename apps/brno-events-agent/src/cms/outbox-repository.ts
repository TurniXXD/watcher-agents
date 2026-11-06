import type { DatabaseClient } from '@watcher/database';
import type { CmsSourceEvent } from './event-item.js';

export type CmsSyncRow = {
  eventId: string;
  attempts: number;
  syncedHash: string | null;
};

export type CmsSyncStatusCounts = Record<
  'PENDING' | 'SYNCED' | 'SKIPPED' | 'FAILED',
  number
>;

const RECONFIRM_AFTER_MS = 20 * 60 * 60 * 1000;

/**
 * Durable delivery state for the CMS. Rows live in PostgreSQL so events are not
 * lost while the CMS is unavailable or the agent restarts.
 */
export class CmsOutboxRepository {
  public constructor(private readonly db: DatabaseClient) {}

  /** New or changed event: (re)queue it immediately with a fresh retry budget. */
  public async markChanged(eventId: string, now = new Date()): Promise<void> {
    await this.db.brnoEventCmsSync.upsert({
      where: { eventId },
      create: { eventId, status: 'PENDING', nextAttemptAt: now },
      update: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
      },
    });
  }

  /**
   * Event seen again unchanged: track it if it predates the integration
   * (backfill) and re-confirm it daily so `lastVerifiedAt` stays fresh.
   */
  public async markSeen(eventId: string, now = new Date()): Promise<void> {
    await this.db.brnoEventCmsSync.createMany({
      data: [{ eventId, status: 'PENDING', nextAttemptAt: now }],
      skipDuplicates: true,
    });
    await this.db.brnoEventCmsSync.updateMany({
      where: {
        eventId,
        status: { in: ['SYNCED', 'SKIPPED'] },
        OR: [
          { syncedAt: null },
          { syncedAt: { lt: new Date(now.getTime() - RECONFIRM_AFTER_MS) } },
        ],
      },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: now },
    });
  }

  public due(limit: number, now = new Date()): Promise<CmsSyncRow[]> {
    return this.db.brnoEventCmsSync.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { eventId: true, attempts: true, syncedHash: true },
    });
  }

  public events(ids: string[]): Promise<CmsSourceEvent[]> {
    return this.db.brnoEvent.findMany({
      where: { id: { in: ids } },
      include: {
        sourceLinks: {
          select: {
            sourceId: true,
            sourceName: true,
            eventUrl: true,
            firstSeenAt: true,
            lastSeenAt: true,
          },
        },
      },
    });
  }

  public async markSynced(
    eventId: string,
    hash: string,
    cmsId: string | undefined,
    now = new Date(),
  ): Promise<void> {
    await this.db.brnoEventCmsSync.update({
      where: { eventId },
      data: {
        status: 'SYNCED',
        syncedHash: hash,
        syncedAt: now,
        lastAttemptAt: now,
        attempts: 0,
        lastError: null,
        ...(cmsId ? { cmsId } : {}),
      },
    });
  }

  public async markSkipped(
    eventId: string,
    reason: string,
    now = new Date(),
  ): Promise<void> {
    await this.db.brnoEventCmsSync.update({
      where: { eventId },
      data: {
        status: 'SKIPPED',
        syncedAt: now,
        lastAttemptAt: now,
        lastError: reason.slice(0, 2000),
      },
    });
  }

  /** Records a failed attempt; terminal failures wait for the next event change. */
  public async markAttemptFailed(
    eventId: string,
    error: string,
    next: { retryAt: Date } | { terminal: true },
    now = new Date(),
  ): Promise<void> {
    await this.db.brnoEventCmsSync.update({
      where: { eventId },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: now,
        lastError: error.slice(0, 2000),
        ...('terminal' in next
          ? { status: 'FAILED' }
          : { nextAttemptAt: next.retryAt }),
      },
    });
  }

  /** Re-queues terminal failures (operator action after fixing a CMS problem). */
  public async retryFailed(now = new Date()): Promise<number> {
    const result = await this.db.brnoEventCmsSync.updateMany({
      where: { status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: now },
    });
    return result.count;
  }

  public async counts(): Promise<CmsSyncStatusCounts> {
    const groups = await this.db.brnoEventCmsSync.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: CmsSyncStatusCounts = {
      PENDING: 0,
      SYNCED: 0,
      SKIPPED: 0,
      FAILED: 0,
    };
    for (const group of groups) counts[group.status] = group._count._all;
    return counts;
  }
}
