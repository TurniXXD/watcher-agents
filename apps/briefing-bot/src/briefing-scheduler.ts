import type { WatcherLogger } from '@watcher/core';
import type {
  BriefingScheduleStore,
  DueBriefingSchedule,
} from '@watcher/database';

type ScheduleStore = Pick<BriefingScheduleStore, 'claimDue'>;

export class BriefingScheduler {
  #timer: NodeJS.Timeout | undefined;
  #activeTick: Promise<void> | undefined;

  public constructor(
    private readonly schedules: ScheduleStore,
    private readonly execute: (schedule: DueBriefingSchedule) => Promise<void>,
    private readonly intervalMs = 30_000,
    private readonly reportError: (error: unknown) => void = () => undefined,
    private readonly logger?: WatcherLogger,
  ) {}

  public start(): void {
    if (this.#timer) return;
    this.logger?.info(
      { intervalMs: this.intervalMs },
      'Briefing scheduler started',
    );
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.intervalMs);
    this.#timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#activeTick;
    this.logger?.info('Briefing scheduler stopped');
  }

  public tick(now = new Date()): Promise<void> {
    if (this.#activeTick) {
      this.logger?.info(
        { now: now.toISOString() },
        'Briefing scheduler tick skipped because the previous tick is active',
      );
      return this.#activeTick;
    }
    const active = (async () => {
      const startedAt = Date.now();
      this.logger?.debug(
        { now: now.toISOString() },
        'Checking for due briefing schedules',
      );
      const due = await this.schedules.claimDue(now);
      if (due.length === 0) {
        this.logger?.debug(
          { durationMs: Date.now() - startedAt },
          'No briefing schedules are due',
        );
        return;
      }
      this.logger?.info(
        {
          dueCount: due.length,
          schedules: due.map(
            ({ id, telegramChatId, scheduledFor, scheduleKey }) => ({
              scheduleId: id,
              telegramChatId: telegramChatId.toString(),
              scheduledFor: scheduledFor.toISOString(),
              scheduleKey,
            }),
          ),
        },
        'Claimed due briefing schedules',
      );
      const results = await Promise.allSettled(due.map(this.execute));
      results.forEach((result) => {
        if (result.status === 'rejected') this.reportError(result.reason);
      });
      this.logger?.info(
        {
          dueCount: due.length,
          succeededCount: results.filter(({ status }) => status === 'fulfilled')
            .length,
          failedCount: results.filter(({ status }) => status === 'rejected')
            .length,
          durationMs: Date.now() - startedAt,
        },
        'Briefing scheduler tick completed',
      );
    })()
      .catch(this.reportError)
      .finally(() => {
        if (this.#activeTick === active) this.#activeTick = undefined;
      });
    this.#activeTick = active;
    return active;
  }
}
