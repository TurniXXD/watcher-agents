import { describe, expect, it, vi } from 'vitest';
import { loadBriefingJournal } from '../briefing-context.js';

describe('briefing journal context', () => {
  it('does not fetch outside the morning briefing', async () => {
    const journal = { loadYesterday: vi.fn() };

    await expect(
      loadBriefingJournal(journal, 'evening', new Date('2026-09-06T18:00:00Z')),
    ).resolves.toEqual({ status: 'DISABLED', value: undefined });
    expect(journal.loadYesterday).not.toHaveBeenCalled();
  });

  it('treats a missing journal as an available empty result', async () => {
    const journal = { loadYesterday: vi.fn(() => Promise.resolve(undefined)) };

    await expect(
      loadBriefingJournal(journal, 'morning', new Date('2026-09-06T05:00:00Z')),
    ).resolves.toEqual({ status: 'AVAILABLE', value: undefined });
  });

  it('degrades an API failure without throwing', async () => {
    const journal = {
      loadYesterday: vi.fn(() => Promise.reject(new Error('Notion failed'))),
    };
    const warn = vi.fn<(payload: { err: unknown }, message: string) => void>();
    const logger = { warn };

    await expect(
      loadBriefingJournal(
        journal,
        'morning',
        new Date('2026-09-06T05:00:00Z'),
        logger as never,
      ),
    ).resolves.toEqual({ status: 'UNAVAILABLE', value: undefined });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0].err).toBeInstanceOf(Error);
    expect(warn.mock.calls[0]?.[1]).toBe('NOTION JOURNAL = DEGRADED');
  });
});
