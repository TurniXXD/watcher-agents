import type { SocialsStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { contactReminderJobPrefix } from '../contact-reminders.js';
import { NetworkingScheduler } from '../scheduler.js';

describe('NetworkingScheduler', () => {
  it('reports a failed database tick without rejecting or wedging the scheduler', async () => {
    const databaseError = new Error('database unavailable');
    const store = {
      listSettings: vi
        .fn()
        .mockRejectedValueOnce(databaseError)
        .mockResolvedValueOnce([]),
      claimDueJobs: vi.fn().mockResolvedValue([]),
    };
    const logger = { error: vi.fn() };
    const scheduler = new NetworkingScheduler({
      store: store as unknown as SocialsStore,
      transport: { send: vi.fn() },
      intervalMs: 30_000,
      defaultTimezone: 'Europe/Prague',
      logger,
    });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { err: databaseError },
      'Networking scheduler tick failed',
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(store.listSettings).toHaveBeenCalledTimes(2);
    expect(store.claimDueJobs).toHaveBeenCalledTimes(1);
  });

  it('seeds and delivers a due Google Sheet contact reminder once', async () => {
    const now = new Date('2026-10-31T08:00:00.000Z');
    const dueJob = {
      id: 'contact-job',
      ownerUserId: 7n,
      chatId: 8n,
      kind: `${contactReminderJobPrefix}identity:2d`,
      payload: {
        contactId: '12',
        metDate: '2026-10-29',
        milestone: '2d',
      },
    };
    const store = {
      listSettings: vi.fn().mockResolvedValue([
        {
          ownerUserId: 7n,
          chatId: 8n,
          timezone: 'Europe/Prague',
          mondayNetworkingReminder: false,
        },
      ]),
      listAttendances: vi.fn().mockResolvedValue([]),
      listContacts: vi.fn().mockResolvedValue([]),
      upsertScheduledJob: vi.fn().mockResolvedValue(undefined),
      claimDueJobs: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([dueJob]),
      completeScheduledJob: vi.fn().mockResolvedValue(undefined),
      failScheduledJob: vi.fn().mockResolvedValue(undefined),
    };
    const contacts = {
      getContacts: vi.fn().mockResolvedValue([
        {
          id: '12',
          name: 'Ada Lovelace',
          metDate: '29. 10. 2026',
          metAt: 'Brno',
          active: true,
        },
      ]),
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const scheduler = new NetworkingScheduler({
      store: store as unknown as SocialsStore,
      contacts,
      transport: { send },
      intervalMs: 30_000,
      defaultTimezone: 'Europe/Prague',
    });

    await scheduler.tick(now);

    expect(store.upsertScheduledJob).toHaveBeenCalledTimes(3);
    expect(store.claimDueJobs).toHaveBeenNthCalledWith(2, now, undefined, [
      contactReminderJobPrefix,
    ]);
    expect(send).toHaveBeenCalledWith(
      8n,
      '🤝 Připomeň se kontaktu\nPřed 2 dny jsi poznal kontakt Ada Lovelace · Brno.\n\nJe čas se ozvat a navázat na vaše setkání.',
    );
    expect(store.completeScheduledJob).toHaveBeenCalledWith('contact-job');
    expect(store.failScheduledJob).not.toHaveBeenCalled();
  });

  it('isolates a Google Sheet sync failure from other scheduled jobs', async () => {
    const sheetError = new Error('sheets unavailable');
    const store = {
      listSettings: vi.fn().mockResolvedValue([
        {
          ownerUserId: 7n,
          chatId: 8n,
          timezone: 'Europe/Prague',
          mondayNetworkingReminder: false,
        },
      ]),
      listAttendances: vi.fn().mockResolvedValue([]),
      listContacts: vi.fn().mockResolvedValue([]),
      claimDueJobs: vi.fn().mockResolvedValue([]),
    };
    const logger = { error: vi.fn() };
    const scheduler = new NetworkingScheduler({
      store: store as unknown as SocialsStore,
      contacts: { getContacts: vi.fn().mockRejectedValue(sheetError) },
      transport: { send: vi.fn() },
      intervalMs: 30_000,
      defaultTimezone: 'Europe/Prague',
      logger,
    });

    await scheduler.tick(new Date('2026-10-31T08:00:00.000Z'));

    expect(logger.error).toHaveBeenCalledWith(
      { err: sheetError },
      'Networking contact reminder sync failed',
    );
    expect(store.claimDueJobs).toHaveBeenCalledTimes(1);
  });
});
