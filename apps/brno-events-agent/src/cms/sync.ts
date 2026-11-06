import { createHash } from 'node:crypto';
import { errorMessage, type WatcherLogger } from '@watcher/core';
import { isPlaceholderEventTitle } from '../domain/normalization.js';
import { CmsRequestError, type ContentCmsClient } from './client.js';
import {
  cmsItemHash,
  toCmsEventItem,
  type CmsEventItem,
} from './event-item.js';
import type { CmsOutboxRepository } from './outbox-repository.js';

export type CmsSyncOptions = {
  batchSize: number;
  maxAttempts: number;
  /** Events that ended longer ago than this are not sent. */
  pastGraceMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
};

export type CmsFlushResult = {
  status: 'idle' | 'busy' | 'completed' | 'deferred';
  sent: number;
  synced: number;
  skipped: number;
  retrying: number;
  failed: number;
};

/** Exponential backoff with ±20% jitter, capped. */
export const backoffDelay = (
  attempt: number,
  base = 30_000,
  max = 6 * 60 * 60_000,
  random = Math.random,
): number => {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.8 + random() * 0.4));
};

/**
 * Flushes the CMS outbox. It runs on its own timer, never inside source runs,
 * so Telegram/briefing delivery never waits for the CMS. Overlapping flushes
 * are prevented in-process; at-least-once delivery is safe because CMS
 * ingestion is idempotent per external id and Idempotency-Key.
 */
export class CmsSyncService {
  #running = false;

  public constructor(
    private readonly outbox: CmsOutboxRepository,
    private readonly client: ContentCmsClient,
    private readonly logger: WatcherLogger,
    private readonly options: CmsSyncOptions,
  ) {}

  public async flush(now = new Date()): Promise<CmsFlushResult> {
    const result: CmsFlushResult = {
      status: 'idle',
      sent: 0,
      synced: 0,
      skipped: 0,
      retrying: 0,
      failed: 0,
    };
    if (this.#running) return { ...result, status: 'busy' };
    this.#running = true;
    try {
      const due = await this.outbox.due(this.options.batchSize, now);
      if (due.length === 0) return result;
      const events = new Map(
        (await this.outbox.events(due.map((row) => row.eventId))).map(
          (event) => [event.id, event],
        ),
      );
      const batch: Array<{
        eventId: string;
        attempts: number;
        item: CmsEventItem;
        hash: string;
      }> = [];
      for (const row of due) {
        const event = events.get(row.eventId);
        if (!event) continue;
        const reason = isPlaceholderEventTitle(event.title)
          ? 'placeholder_title'
          : (event.endAt ?? event.startAt).getTime() <
              now.getTime() - (this.options.pastGraceMs ?? 86_400_000)
            ? 'past_event'
            : null;
        if (reason) {
          await this.outbox.markSkipped(row.eventId, reason, now);
          result.skipped++;
          continue;
        }
        let item: CmsEventItem;
        try {
          item = toCmsEventItem(event);
        } catch (error) {
          await this.outbox.markAttemptFailed(
            row.eventId,
            errorMessage(error),
            { terminal: true },
            now,
          );
          result.failed++;
          continue;
        }
        const hash = cmsItemHash(item);
        if (hash === row.syncedHash) {
          await this.outbox.markSynced(row.eventId, hash, undefined, now);
          result.synced++;
          continue;
        }
        batch.push({
          eventId: row.eventId,
          attempts: row.attempts,
          item,
          hash,
        });
      }
      if (batch.length === 0) return { ...result, status: 'completed' };

      const idempotencyKey = createHash('sha256')
        .update(
          batch.map(({ eventId, hash }) => `${eventId}:${hash}`).join('\n'),
        )
        .digest('base64url')
        .slice(0, 64);
      result.sent = batch.length;
      try {
        const run = await this.client.ingestEvents(
          batch.map(({ item }) => item),
          idempotencyKey,
        );
        for (const [index, entry] of batch.entries()) {
          const outcome = run.results.find(
            (candidate) => candidate.index === index,
          );
          if (outcome && outcome.outcome !== 'failed') {
            await this.outbox.markSynced(
              entry.eventId,
              entry.hash,
              outcome.id,
              now,
            );
            result.synced++;
          } else {
            const message = outcome
              ? `${outcome.reason ?? 'failed'}${outcome.details ? `: ${JSON.stringify(outcome.details).slice(0, 1500)}` : ''}`
              : 'missing result';
            await this.retryOrFail(
              entry,
              message,
              outcome?.retryable ?? true,
              now,
              result,
            );
          }
        }
        this.logger.info(
          { runId: run.runId, runStatus: run.status, ...result },
          'Brno events CMS sync completed',
        );
        return { ...result, status: 'completed' };
      } catch (error) {
        const retryable =
          !(error instanceof CmsRequestError) || error.retryable;
        for (const entry of batch)
          await this.retryOrFail(entry, errorMessage(error), true, now, result);
        this.logger.warn(
          {
            err: errorMessage(error),
            retryable,
            status: error instanceof CmsRequestError ? error.status : undefined,
            batch: batch.length,
          },
          'Brno events CMS sync deferred',
        );
        return { ...result, status: 'deferred' };
      }
    } finally {
      this.#running = false;
    }
  }

  private async retryOrFail(
    entry: { eventId: string; attempts: number },
    message: string,
    retryable: boolean,
    now: Date,
    result: CmsFlushResult,
  ): Promise<void> {
    const attempt = entry.attempts + 1;
    if (!retryable || attempt >= this.options.maxAttempts) {
      await this.outbox.markAttemptFailed(
        entry.eventId,
        message,
        { terminal: true },
        now,
      );
      result.failed++;
      this.logger.warn(
        { eventId: entry.eventId, attempt, err: message },
        'Brno event CMS sync failed permanently',
      );
      return;
    }
    const delay = backoffDelay(
      attempt,
      this.options.baseBackoffMs,
      this.options.maxBackoffMs,
      this.options.random,
    );
    await this.outbox.markAttemptFailed(
      entry.eventId,
      message,
      { retryAt: new Date(now.getTime() + delay) },
      now,
    );
    result.retrying++;
  }
}
