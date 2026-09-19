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
    enabled: boolean;
    nextRunAt: Date;
    lastRunAt?: Date;
    runInProgress: boolean;
    lastRunStatus?: string;
    health?: string;
    healthLastRunAt?: Date;
  };
  brnoEvents: { enabled: boolean };
  brnoEventSources: Array<{
    sourceId: string;
    lastRunAt: Date;
    success: boolean;
  }>;
};

export type WatcherRunRequestResult =
  | { status: 'QUEUED' }
  | { status: 'BUSY' }
  | { status: 'DISABLED' }
  | { status: 'NOT_CONFIGURED' };

const watcherDefinitions = [
  { id: 'stocks', kind: 'STOCKS', healthKind: 'STOCKS' },
  { id: 'medical', kind: 'PUBLICATIONS', healthKind: 'MEDICAL' },
  { id: 'news', kind: 'NEWS', healthKind: 'NEWS' },
] as const;

export class AgentScheduleStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async requestWatcherRun(
    telegramChatId: bigint,
    watcherId: WatcherScheduleOverview['id'],
    requestedAt = new Date(),
  ): Promise<WatcherRunRequestResult> {
    const definition = watcherDefinitions.find(({ id }) => id === watcherId);
    if (!definition) return { status: 'NOT_CONFIGURED' };
    const chat = await this.db.telegramChat.findUnique({
      where: {
        kind_chatId: { kind: definition.kind, chatId: telegramChatId },
      },
      select: {
        watcherConfig: {
          select: { id: true, enabled: true, runInProgress: true },
        },
      },
    });
    const config = chat?.watcherConfig;
    if (!config) return { status: 'NOT_CONFIGURED' };
    if (!config.enabled) return { status: 'DISABLED' };
    if (config.runInProgress) return { status: 'BUSY' };
    const claimed = await this.db.watcherConfig.updateMany({
      where: { id: config.id, enabled: true, runInProgress: false },
      data: { nextRunAt: requestedAt },
    });
    return claimed.count === 1 ? { status: 'QUEUED' } : { status: 'BUSY' };
  }

  /** Controls scheduled collection only; manual commands intentionally remain usable. */
  public async setAllScheduledAgentsEnabled(
    telegramChatId: bigint,
    enabled: boolean,
    now = new Date(),
  ): Promise<WatcherScheduleOverview[]> {
    const chats = await this.db.telegramChat.findMany({
      where: {
        chatId: telegramChatId,
        kind: { in: watcherDefinitions.map(({ kind }) => kind) },
      },
      select: { watcherConfig: { select: { id: true } } },
    });
    const configIds = chats.flatMap(({ watcherConfig }) =>
      watcherConfig ? [watcherConfig.id] : [],
    );
    await this.db.$transaction([
      ...(configIds.length
        ? [
            this.db.watcherConfig.updateMany({
              where: { id: { in: configIds } },
              data: { enabled, ...(enabled ? { nextRunAt: now } : {}) },
            }),
          ]
        : []),
      this.db.muMonitorState.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', enabled, nextRunAt: now },
        update: { enabled, ...(enabled ? { nextRunAt: now } : {}) },
      }),
      this.db.brnoEventAgentState.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', enabled },
        update: { enabled },
      }),
    ]);
    return (await this.get(telegramChatId)).watchers;
  }

  public async get(telegramChatId: bigint): Promise<AgentScheduleOverview> {
    const [briefing, chats, muState, muRun, health, brnoRuns, brnoState] =
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
        this.db.brnoEventAgentState.findUnique({ where: { id: 'singleton' } }),
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
              enabled: muState.enabled,
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
      brnoEvents: { enabled: brnoState?.enabled ?? true },
      brnoEventSources: brnoRuns.map((run) => ({
        sourceId: run.sourceId,
        lastRunAt: run.finishedAt,
        success: run.success,
      })),
    };
  }
}
