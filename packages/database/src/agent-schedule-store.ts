import type { DatabaseClient } from './client.js';

export type WatcherScheduleOverview = {
  id: 'stocks' | 'medical' | 'news';
  configured: boolean;
  enabled: boolean;
  schedule?: string;
  timezone?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  lastRunStatus?: string;
  runInProgress: boolean;
  health?: string;
  healthLastRunAt?: Date;
};

export type AgentScheduleOverview = {
  briefing?: {
    enabled: boolean;
    schedule: string;
    timezone: string;
    nextRunAt?: Date;
  };
  watchers: WatcherScheduleOverview[];
  muClubs?: {
    nextRunAt: Date;
    lastRunAt?: Date;
    runInProgress: boolean;
    lastRunStatus?: string;
    health?: string;
    healthLastRunAt?: Date;
  };
  brnoEventSources: Array<{
    sourceId: string;
    lastRunAt: Date;
    success: boolean;
  }>;
};

const watcherDefinitions = [
  { id: 'stocks', kind: 'STOCKS', healthKind: 'STOCKS' },
  { id: 'medical', kind: 'PUBLICATIONS', healthKind: 'MEDICAL' },
  { id: 'news', kind: 'NEWS', healthKind: 'NEWS' },
] as const;

export class AgentScheduleStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async get(telegramChatId: bigint): Promise<AgentScheduleOverview> {
    const [briefing, chats, muState, muRun, health, brnoRuns] =
      await Promise.all([
        this.db.briefingSettings.findUnique({
          where: { telegramChatId },
          select: {
            onboardingComplete: true,
            briefingTime: true,
            timezone: true,
            nextBriefingAt: true,
          },
        }),
        this.db.telegramChat.findMany({
          where: { chatId: telegramChatId },
          include: { watcherConfig: true },
        }),
        this.db.muMonitorState.findUnique({ where: { id: 'singleton' } }),
        this.db.muMonitorRun.findFirst({
          orderBy: { startedAt: 'desc' },
          select: { status: true },
        }),
        this.db.briefingWatcherHealth.findMany(),
        this.db.brnoEventSourceRun.findMany({
          orderBy: { finishedAt: 'desc' },
          distinct: ['sourceId'],
          select: { sourceId: true, finishedAt: true, success: true },
        }),
      ]);
    const healthByWatcher = new Map(
      health.map((entry) => [entry.watcherBot.toString(), entry]),
    );
    const chatByKind = new Map(
      chats.map((chat) => [chat.kind.toString(), chat]),
    );
    const watchers = watcherDefinitions.map(({ id, kind, healthKind }) => {
      const config = chatByKind.get(kind)?.watcherConfig;
      const watcherHealth = healthByWatcher.get(healthKind);
      return {
        id,
        configured: Boolean(config),
        enabled: config?.enabled ?? false,
        ...(config?.schedule ? { schedule: config.schedule } : {}),
        ...(config?.timezone ? { timezone: config.timezone } : {}),
        ...(config?.nextRunAt ? { nextRunAt: config.nextRunAt } : {}),
        ...(config?.lastRunAt ? { lastRunAt: config.lastRunAt } : {}),
        ...(config?.lastRunStatus
          ? { lastRunStatus: config.lastRunStatus.toString() }
          : {}),
        runInProgress: config?.runInProgress ?? false,
        ...(watcherHealth
          ? {
              health: watcherHealth.status.toString(),
              healthLastRunAt: watcherHealth.lastRunAt,
            }
          : {}),
      } satisfies WatcherScheduleOverview;
    });
    const muHealth = healthByWatcher.get('MU_CLUBS');
    return {
      ...(briefing
        ? {
            briefing: {
              enabled: briefing.onboardingComplete,
              schedule: briefing.briefingTime,
              timezone: briefing.timezone,
              ...(briefing.nextBriefingAt
                ? { nextRunAt: briefing.nextBriefingAt }
                : {}),
            },
          }
        : {}),
      watchers,
      ...(muState
        ? {
            muClubs: {
              nextRunAt: muState.nextRunAt,
              ...(muState.lastRunAt ? { lastRunAt: muState.lastRunAt } : {}),
              runInProgress: muState.runInProgress,
              ...(muRun ? { lastRunStatus: muRun.status.toString() } : {}),
              ...(muHealth
                ? {
                    health: muHealth.status.toString(),
                    healthLastRunAt: muHealth.lastRunAt,
                  }
                : {}),
            },
          }
        : {}),
      brnoEventSources: brnoRuns.map((run) => ({
        sourceId: run.sourceId,
        lastRunAt: run.finishedAt,
        success: run.success,
      })),
    };
  }
}
