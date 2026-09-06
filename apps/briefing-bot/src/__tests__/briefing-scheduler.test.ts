import { describe, expect, it, vi } from 'vitest';
import { BriefingScheduler } from '../briefing-scheduler.js';

describe('BriefingScheduler', () => {
  it('runs every claimed occurrence and does not overlap ticks', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const schedule = {
      id: 'settings-1',
      telegramChatId: 123n,
      scheduledFor: new Date('2026-09-06T05:00:00.000Z'),
    };
    const claimDue = vi.fn(async () => [schedule]);
    const execute = vi.fn(async () => waiting);
    const scheduler = new BriefingScheduler({ claimDue }, execute);

    const first = scheduler.tick(new Date('2026-09-06T05:00:01.000Z'));
    const overlapping = scheduler.tick(new Date('2026-09-06T05:00:02.000Z'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(first).toBe(overlapping);
    release?.();
    await first;
    expect(claimDue).toHaveBeenCalledTimes(1);
  });

  it('isolates one scheduled failure and reports it', async () => {
    const reportError = vi.fn();
    const schedules = [
      {
        id: 'one',
        telegramChatId: 1n,
        scheduledFor: new Date('2026-09-06T05:00:00.000Z'),
      },
      {
        id: 'two',
        telegramChatId: 2n,
        scheduledFor: new Date('2026-09-06T05:00:00.000Z'),
      },
    ];
    const execute = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'one') throw new Error('one failed');
    });
    const scheduler = new BriefingScheduler(
      { claimDue: async () => schedules },
      execute,
      30_000,
      reportError,
    );

    await scheduler.tick();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error));
  });
});
