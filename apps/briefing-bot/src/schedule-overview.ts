import type { AgentScheduleOverview } from '@watcher/database';

export type AgentScheduleReader = {
  get(telegramChatId: bigint): Promise<AgentScheduleOverview>;
};

const labels = {
  stocks: 'Stocks bot',
  medical: 'Publications bot',
  news: 'News bot',
} as const;

const time = (value: Date | undefined): string =>
  value?.toISOString().replace('.000Z', 'Z') ?? 'not scheduled';

const timing = (
  configured: boolean,
  enabled: boolean,
  nextRunAt: Date | undefined,
  nextBriefingAt: Date | undefined,
  now: Date,
): string | undefined => {
  if (!configured) return '⚠️ Producer is not configured for this chat';
  if (!enabled) return '⏸ Scheduled runs are paused';
  if (nextRunAt && nextRunAt.getTime() < now.getTime() - 120_000)
    return '⚠️ Scheduled run is overdue';
  if (!nextBriefingAt) return undefined;
  if (!nextRunAt) return '⚠️ No run is scheduled before the next briefing';
  return nextRunAt <= nextBriefingAt
    ? '✅ Runs before the next briefing'
    : '⚠️ Next run is after the next briefing';
};

const stateIcon = (input: {
  configured: boolean;
  enabled: boolean;
  runInProgress: boolean;
  health?: string;
}): string => {
  if (!input.configured) return '⚪';
  if (!input.enabled) return '⏸';
  if (input.runInProgress) return '🔄';
  if (input.health === 'UNAVAILABLE') return '🔴';
  if (input.health === 'DEGRADED') return '🟠';
  return input.health === 'HEALTHY' ? '🟢' : '🟡';
};

export const renderAgentSchedules = (
  overview: AgentScheduleOverview,
  now = new Date(),
): string => {
  const nextBriefingAt = overview.briefing?.nextRunAt;
  const sections = overview.watchers.map((watcher) => {
    const beforeBriefing = timing(
      watcher.configured,
      watcher.enabled,
      watcher.nextRunAt,
      nextBriefingAt,
      now,
    );
    return [
      `${stateIcon(watcher)} ${labels[watcher.id]}`,
      watcher.configured
        ? `Schedule: ${watcher.schedule} (${watcher.timezone})`
        : 'Schedule: not configured for this chat',
      `Next: ${time(watcher.nextRunAt)}`,
      `Last: ${time(watcher.lastRunAt)}${watcher.lastRunStatus ? ` · ${watcher.lastRunStatus}` : ''}`,
      ...(watcher.health
        ? [
            `Producer health: ${watcher.health} · checked ${time(watcher.healthLastRunAt)}`,
          ]
        : []),
      ...(beforeBriefing ? [beforeBriefing] : []),
    ].join('\n');
  });
  if (overview.muClubs) {
    const beforeBriefing = timing(
      true,
      true,
      overview.muClubs.nextRunAt,
      nextBriefingAt,
      now,
    );
    sections.push(
      [
        `${stateIcon({
          configured: true,
          enabled: true,
          runInProgress: overview.muClubs.runInProgress,
          ...(overview.muClubs.health
            ? { health: overview.muClubs.health }
            : {}),
        })} MU Clubs monitor`,
        `Next: ${time(overview.muClubs.nextRunAt)}`,
        `Last: ${time(overview.muClubs.lastRunAt)}${overview.muClubs.lastRunStatus ? ` · ${overview.muClubs.lastRunStatus}` : ''}`,
        ...(overview.muClubs.health
          ? [
              `Producer health: ${overview.muClubs.health} · checked ${time(overview.muClubs.healthLastRunAt)}`,
            ]
          : []),
        ...(beforeBriefing ? [beforeBriefing] : []),
      ].join('\n'),
    );
  } else {
    sections.push('⚪ MU Clubs monitor\nSchedule: not initialized');
  }
  sections.push(
    overview.brnoEventSources.length > 0
      ? [
          '📍 Brno Events agent',
          ...overview.brnoEventSources.map(
            (source) =>
              `${source.success ? '✅' : '❌'} ${source.sourceId}: ${time(source.lastRunAt)}`,
          ),
        ].join('\n')
      : '⚪ Brno Events agent\nNo source runs recorded',
  );
  sections.push(
    overview.briefing
      ? [
          `${overview.briefing.enabled ? '🟢' : '⏸'} Briefing bot`,
          `Schedule: ${overview.briefing.schedule} (${overview.briefing.timezone})`,
          `Next: ${time(overview.briefing.nextRunAt)}`,
        ].join('\n')
      : '⚪ Briefing bot\nSchedule: not configured',
  );
  return ['🗓 Agent schedules', ...sections].join('\n\n');
};
