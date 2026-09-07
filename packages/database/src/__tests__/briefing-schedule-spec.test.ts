import { describe, expect, it } from 'vitest';
import {
  defaultBriefingScheduleSpec,
  nextBriefingOccurrence,
  normalizeBriefingScheduleSpec,
} from '../briefing-schedule-spec.js';

describe('briefing schedule spec', () => {
  it('keeps legacy single-time schedules valid', () => {
    expect(normalizeBriefingScheduleSpec(' 07:00 ')).toBe('07:00');
    expect(
      nextBriefingOccurrence(
        '07:00',
        'Europe/Prague',
        new Date('2026-09-07T04:30:00.000Z'),
      ),
    ).toMatchObject({
      entry: { key: 'daily:07:00' },
      scheduledFor: new Date('2026-09-07T05:00:00.000Z'),
    });
  });

  it('normalizes weekly entries and prefers weekly lookback over daily at the same local time', () => {
    expect(normalizeBriefingScheduleSpec('07:00; weekly:mon:07:00')).toBe(
      '07:00;weekly:MON:07:00',
    );
    expect(
      nextBriefingOccurrence(
        defaultBriefingScheduleSpec,
        'Europe/Prague',
        new Date('2026-09-07T04:30:00.000Z'),
      ),
    ).toMatchObject({
      entry: { key: 'weekly:MON:07:00', periodHours: 168 },
      scheduledFor: new Date('2026-09-07T05:00:00.000Z'),
    });
  });
});
