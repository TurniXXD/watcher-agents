import { describe, expect, it } from 'vitest';
import { renderAgentSchedules } from '../schedule-overview.js';

describe('agent schedule overview', () => {
  it('shows producer timing relative to the next briefing', () => {
    const rendered = renderAgentSchedules(
      {
        briefing: {
          enabled: true,
          schedule: '07:00;20:00',
          timezone: 'Europe/Prague',
          nextRunAt: new Date('2026-09-09T05:00:00Z'),
        },
        watchers: [
          {
            id: 'stocks',
            configured: true,
            enabled: true,
            schedule: '30 6 * * *',
            timezone: 'Europe/Prague',
            nextRunAt: new Date('2026-09-09T04:30:00Z'),
            lastRunAt: new Date('2026-09-08T04:30:00Z'),
            lastRunStatus: 'SUCCESS',
            runInProgress: false,
            health: 'HEALTHY',
            healthLastRunAt: new Date('2026-09-08T04:31:00Z'),
          },
          {
            id: 'medical',
            configured: true,
            enabled: true,
            schedule: '30 8 * * *',
            timezone: 'Europe/Prague',
            nextRunAt: new Date('2026-09-09T06:30:00Z'),
            runInProgress: false,
          },
          {
            id: 'news',
            configured: false,
            enabled: false,
            runInProgress: false,
          },
        ],
        brnoEventSources: [],
      },
      new Date('2026-09-08T00:00:00Z'),
    );

    expect(rendered).toContain('🗓 Agent schedules');
    expect(rendered).toContain('🟢 Stocks bot');
    expect(rendered).toContain('✅ Runs before the next briefing');
    expect(rendered).toContain(
      'Next scheduled run is after the next briefing; Briefing requests one if data is stale',
    );
    expect(rendered).toContain('⚪ News bot');
    expect(rendered).toContain('Producer is not configured for this chat');
    expect(rendered).toContain('⚪ MU Clubs monitor');
    expect(rendered).toContain('⚪ Brno Events agent');
  });
});
