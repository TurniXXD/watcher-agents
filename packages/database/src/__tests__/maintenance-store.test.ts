import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { type FindingInput, MaintenanceStore } from '../maintenance-store.js';

describe('MaintenanceStore', () => {
  it('does not leak a detector recommendation into the finding relation input', async () => {
    const upsert = vi.fn<
      (input: { create: Record<string, unknown> }) => Promise<{ id: string }>
    >(async () => ({ id: 'finding-1' }));
    const database = {
      maintenanceFinding: { upsert },
    } as unknown as DatabaseClient;
    const detectedAt = new Date('2026-09-09T15:20:58.839Z');
    const finding = {
      fingerprint: 'finding-fingerprint',
      agentName: 'stocks-bot',
      type: 'RECURRING_FAILURE',
      severity: 'CRITICAL',
      title: 'NEWS is failing repeatedly',
      description: '544 of 544 source requests failed.',
      evidence: { sourceId: 'NEWS', failureCount: 544 },
      confidence: 0.98,
      detectedAt,
      recommendation: {
        type: 'SOURCE_CHANGE',
        title: 'Repair NEWS',
        rationale: 'Repeated failures reduce coverage.',
      },
    } satisfies FindingInput & {
      recommendation: {
        type: string;
        title: string;
        rationale: string;
      };
    };

    await new MaintenanceStore(database).upsertFinding(finding);

    expect(upsert).toHaveBeenCalledOnce();
    const input = upsert.mock.calls[0]?.[0];
    if (!input) throw new Error('Expected maintenance finding upsert input');
    expect(input.create).toEqual({
      fingerprint: 'finding-fingerprint',
      agentName: 'stocks-bot',
      type: 'RECURRING_FAILURE',
      severity: 'CRITICAL',
      title: 'NEWS is failing repeatedly',
      description: '544 of 544 source requests failed.',
      evidence: { sourceId: 'NEWS', failureCount: 544 },
      confidence: 0.98,
      detectedAt,
      lastSeenAt: detectedAt,
    });
    expect(input.create).not.toHaveProperty('recommendation');
    expect(input.create).not.toHaveProperty('recommendations');
  });

  it('can release a failed changelog announcement for retry', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const database = {
      maintenanceChangeAnnouncement: { deleteMany },
    } as unknown as DatabaseClient;

    await new MaintenanceStore(database).releaseChangeAnnouncement(
      'content-hash',
      42n,
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { contentHash: 'content-hash', chatId: 42n },
    });
  });

  it('starts a fresh persistent debug reporting window', async () => {
    const upsert = vi.fn(async () => ({ chatId: 42n, enabled: true }));
    const database = {
      maintenanceDebugSubscription: { upsert },
    } as unknown as DatabaseClient;
    const now = new Date('2026-09-10T12:00:00Z');

    await new MaintenanceStore(database).setDebugEnabled(42n, true, now);

    expect(upsert).toHaveBeenCalledWith({
      where: { chatId: 42n },
      create: { chatId: 42n, enabled: true, enabledAt: now },
      update: {
        enabled: true,
        enabledAt: now,
        deliveries: { deleteMany: {} },
      },
    });
  });
});
