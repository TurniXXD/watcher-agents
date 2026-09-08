import { describe, expect, it } from 'vitest';
import {
  appendStockSchedule,
  removeStockSchedule,
  renderStockSchedules,
} from '../schedule-management.js';

describe('stock schedule management', () => {
  it('adds one normalized cron expression without replacing existing schedules', () => {
    expect(appendStockSchedule('0 7 * * *', '  0  20 * * * ')).toEqual({
      schedule: '0 7 * * *; 0 20 * * *',
      added: true,
    });
  });

  it('does not add a duplicate schedule', () => {
    expect(appendStockSchedule('0 7 * * *; 0 20 * * *', '0  20 * * *')).toEqual(
      { schedule: '0 7 * * *; 0 20 * * *', added: false },
    );
  });

  it('removes a schedule by its displayed number', () => {
    expect(removeStockSchedule('0 7 * * *; 0 12 * * *; 0 20 * * *', 2)).toBe(
      '0 7 * * *; 0 20 * * *',
    );
  });

  it('keeps at least one schedule configured', () => {
    expect(() => removeStockSchedule('0 7 * * *', 1)).toThrow(
      'Use /pause instead',
    );
  });

  it('renders numbered schedules, timezone, and next run', () => {
    expect(
      renderStockSchedules(
        '0 7 * * *; 0 20 * * *',
        'Europe/Prague',
        new Date('2026-09-08T18:00:00.000Z'),
      ),
    ).toContain('2. 0 20 * * *\nNext run: 2026-09-08T18:00:00.000Z');
  });
});
