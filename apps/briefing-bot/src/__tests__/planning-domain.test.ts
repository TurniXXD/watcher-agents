import { describe, expect, it } from 'vitest';
import {
  calculateExecutionMetrics,
  formatDurationMinutes,
  parseDurationMinutes,
  parseTaskCaptures,
  reviewOrderForDate,
} from '../planning/domain.js';

describe('Bullet Journal planning domain', () => {
  it.each([
    ['15m', 15],
    ['1h', 60],
    ['1h15m', 75],
    ['2h30m', 150],
  ])('parses and formats %s', (input, expected) => {
    expect(parseDurationMinutes(input)).toBe(expected);
    expect(parseDurationMinutes(formatDurationMinutes(expected))).toBe(
      expected,
    );
  });

  it.each(['', '0m', '1h60m', '25h', 'hour'])(
    'rejects malformed %s',
    (input) => {
      expect(() => parseDurationMinutes(input)).toThrow();
    },
  );

  it('captures multiple natural-language tasks without inventing estimates', () => {
    expect(
      parseTaskCaptures(
        'Today I want to study linear algebra for 1h30m, work on Watcher for 2h, and go running for 45m.',
      ),
    ).toEqual([
      { title: 'study linear algebra', estimatedMinutes: 90 },
      { title: 'work on Watcher', estimatedMinutes: 120 },
      { title: 'go running', estimatedMinutes: 45 },
    ]);
    expect(parseTaskCaptures('Přidej zavolat rodičům')).toEqual([
      { title: 'zavolat rodičům' },
    ]);
  });

  it('calculates factual execution metrics without a productivity score', () => {
    expect(
      calculateExecutionMetrics([
        {
          status: 'COMPLETED',
          source: 'PLANNED',
          estimatedMinutes: 60,
          actualMinutes: 75,
          goalId: 1,
        },
        { status: 'MIGRATED', source: 'PLANNED', estimatedMinutes: 30 },
        { status: 'CANCELLED', source: 'PLANNED' },
        { status: 'COMPLETED', source: 'UNPLANNED' },
      ]),
    ).toEqual({
      plannedTasks: 3,
      completedPlannedTasks: 1,
      unplannedCompletedTasks: 1,
      migratedTasks: 1,
      cancelledTasks: 1,
      completionPercentage: 33,
      estimatedWorkloadMinutes: 90,
      actualTrackedMinutes: 75,
      linkedCompletedTasks: 1,
      missingActualDuration: 1,
    });
  });

  it('orders daily, journal, weekly and month-end review deterministically', () => {
    expect(reviewOrderForDate('2026-10-25')).toEqual([
      'DAILY',
      'JOURNAL',
      'WEEKLY',
    ]);
    expect(reviewOrderForDate('2027-01-31')).toEqual([
      'DAILY',
      'JOURNAL',
      'WEEKLY',
      'MONTHLY',
    ]);
  });
});
