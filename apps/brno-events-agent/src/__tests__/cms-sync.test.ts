import { describe, expect, it, vi } from 'vitest';
import type { WatcherLogger } from '@watcher/core';
import { CmsRequestError, type ContentCmsClient } from '../cms/client.js';
import type { CmsSourceEvent } from '../cms/event-item.js';
import { cmsItemHash, toCmsEventItem } from '../cms/event-item.js';
import type {
  CmsOutboxRepository,
  CmsSyncRow,
} from '../cms/outbox-repository.js';
import { backoffDelay, CmsSyncService } from '../cms/sync.js';

const now = new Date('2026-11-06T12:00:00Z');
const logger = { info: vi.fn(), warn: vi.fn() } as unknown as WatcherLogger;

const sourceEvent = (
  id: string,
  overrides: Partial<CmsSourceEvent> = {},
): CmsSourceEvent => ({
  id,
  title: `Event ${id}`,
  description: null,
  startAt: new Date('2026-11-20T17:00:00Z'),
  endAt: null,
  venueName: null,
  venueAddress: null,
  city: 'Brno',
  organizerName: null,
  categories: ['ai'],
  priceAmount: null,
  priceCurrency: null,
  priceFree: null,
  priceText: null,
  registrationRequired: null,
  registrationUrl: null,
  imageUrl: null,
  cancelled: false,
  lastSeenAt: now,
  sourceLinks: [
    {
      sourceId: 's',
      sourceName: 'Source',
      eventUrl: `https://organiser.example.org/${id}`,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  ],
  ...overrides,
});

const harness = (
  rows: CmsSyncRow[],
  events: CmsSourceEvent[],
  ingestEvents: ContentCmsClient['ingestEvents'],
) => {
  const outbox = {
    due: vi.fn(async () => rows),
    events: vi.fn(async () => events),
    markSynced: vi.fn(async () => undefined),
    markSkipped: vi.fn(async () => undefined),
    markAttemptFailed: vi.fn(async () => undefined),
  };
  const client = { ingestEvents: vi.fn(ingestEvents) };
  const service = new CmsSyncService(
    outbox as unknown as CmsOutboxRepository,
    client as unknown as ContentCmsClient,
    logger,
    {
      batchSize: 50,
      maxAttempts: 3,
      random: () => 0.5,
    },
  );
  return { outbox, client, service };
};

describe('CMS outbox sync', () => {
  it('marks accepted items synced and sends a deterministic Idempotency-Key', async () => {
    const { outbox, client, service } = harness(
      [{ eventId: 'a', attempts: 0, syncedHash: null }],
      [sourceEvent('a')],
      async () => ({
        runId: 'r',
        status: 'succeeded',
        results: [
          {
            index: 0,
            externalId: 'brno-event:a',
            outcome: 'created',
            id: 'cms-1',
          },
        ],
      }),
    );
    expect(await service.flush(now)).toMatchObject({
      status: 'completed',
      sent: 1,
      synced: 1,
    });
    expect(outbox.markSynced).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'cms-1',
      now,
    );
    const firstKey = client.ingestEvents.mock.calls[0]![1];
    await service.flush(now);
    expect(client.ingestEvents.mock.calls[1]![1]).toBe(firstKey);
  });

  it('keeps items queued with backoff during a CMS outage and never throws', async () => {
    const { outbox, service } = harness(
      [{ eventId: 'a', attempts: 0, syncedHash: null }],
      [sourceEvent('a')],
      async () => {
        throw new CmsRequestError('CMS unreachable', true);
      },
    );
    expect(await service.flush(now)).toMatchObject({
      status: 'deferred',
      retrying: 1,
      failed: 0,
    });
    expect(outbox.markAttemptFailed).toHaveBeenCalledWith(
      'a',
      'CMS unreachable',
      { retryAt: new Date(now.getTime() + 30_000) },
      now,
    );
  });

  it('stops retrying after the bounded number of attempts', async () => {
    const { outbox, service } = harness(
      [{ eventId: 'a', attempts: 2, syncedHash: null }],
      [sourceEvent('a')],
      async () => {
        throw new CmsRequestError('CMS responded with HTTP 503', true, 503);
      },
    );
    expect(await service.flush(now)).toMatchObject({ failed: 1, retrying: 0 });
    expect(outbox.markAttemptFailed).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      { terminal: true },
      now,
    );
  });

  it('fails non-retryable item rejections immediately and retries retryable ones', async () => {
    const { outbox, service } = harness(
      [
        { eventId: 'a', attempts: 0, syncedHash: null },
        { eventId: 'b', attempts: 0, syncedHash: null },
      ],
      [sourceEvent('a'), sourceEvent('b')],
      async () => ({
        runId: 'r',
        status: 'partial',
        results: [
          {
            index: 0,
            externalId: 'a',
            outcome: 'failed',
            reason: 'validation_failed',
            retryable: false,
          },
          {
            index: 1,
            externalId: 'b',
            outcome: 'failed',
            reason: 'internal_error',
            retryable: true,
          },
        ],
      }),
    );
    expect(await service.flush(now)).toMatchObject({ failed: 1, retrying: 1 });
    expect(outbox.markAttemptFailed).toHaveBeenCalledWith(
      'a',
      'validation_failed',
      { terminal: true },
      now,
    );
  });

  it('skips past events and placeholders and does not resend unchanged payloads', async () => {
    const unchanged = sourceEvent('c');
    const { outbox, client, service } = harness(
      [
        { eventId: 'past', attempts: 0, syncedHash: null },
        { eventId: 'tba', attempts: 0, syncedHash: null },
        {
          eventId: 'c',
          attempts: 0,
          syncedHash: cmsItemHash(toCmsEventItem(unchanged)),
        },
      ],
      [
        sourceEvent('past', { startAt: new Date('2026-10-01T10:00:00Z') }),
        sourceEvent('tba', { title: 'Meetup TBA' }),
        unchanged,
      ],
      async () => {
        throw new Error('should not be called');
      },
    );
    expect(await service.flush(now)).toMatchObject({
      skipped: 2,
      synced: 1,
      sent: 0,
    });
    expect(client.ingestEvents).not.toHaveBeenCalled();
    expect(outbox.markSkipped).toHaveBeenCalledWith('past', 'past_event', now);
  });

  it('prevents overlapping flushes', async () => {
    let release: () => void = () => undefined;
    const { service } = harness(
      [{ eventId: 'a', attempts: 0, syncedHash: null }],
      [sourceEvent('a')],
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              runId: 'r',
              status: 'succeeded',
              results: [{ index: 0, externalId: 'a', outcome: 'created' }],
            });
        }),
    );
    const first = service.flush(now);
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await service.flush(now)).status).toBe('busy');
    release();
    expect((await first).status).toBe('completed');
  });

  it('computes capped exponential backoff with jitter', () => {
    expect(backoffDelay(1, 30_000, 3_600_000, () => 0.5)).toBe(30_000);
    expect(backoffDelay(3, 30_000, 3_600_000, () => 0.5)).toBe(120_000);
    expect(backoffDelay(20, 30_000, 3_600_000, () => 0.5)).toBe(3_600_000);
    expect(backoffDelay(1, 30_000, 3_600_000, () => 0)).toBe(24_000);
  });
});
