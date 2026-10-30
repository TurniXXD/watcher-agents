import type {
  BulletJournalStore,
  PlanningSessionRecord,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';

export class PlanningScheduler {
  #timer: NodeJS.Timeout | undefined;
  #active: Promise<void> | undefined;

  public constructor(
    private readonly store: BulletJournalStore,
    private readonly deliver: (session: PlanningSessionRecord) => Promise<void>,
    private readonly synchronize: (() => Promise<void>) | undefined,
    private readonly options: {
      enabled: boolean;
      timezone: string;
      morningTime: string;
      eveningTime: string;
      followUpDelayMs: number;
      followUpEnabled: boolean;
      intervalMs: number;
      logger?: WatcherLogger;
    },
  ) {}

  public start(): void {
    if (!this.options.enabled || this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.#timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#active;
  }

  public tick(now = new Date()): Promise<void> {
    if (this.#active) return this.#active;
    const active = (async () => {
      await this.store.initializeScheduledSessions(
        now,
        this.options.timezone,
        this.options.morningTime,
        this.options.eveningTime,
      );
      const due = await this.store.claimDuePlanningReminders(now);
      for (const session of due) {
        try {
          await this.deliver(session);
          await this.store.markPlanningReminderSent(session.id, now);
        } catch (error) {
          await this.store.releasePlanningReminder(session.id);
          this.options.logger?.error(
            { err: error, planningSessionId: session.id, kind: session.kind },
            'Planning reminder failed',
          );
        }
      }
      if (this.options.followUpEnabled) {
        const followUps = await this.store.claimMorningFollowUps(
          now,
          this.options.followUpDelayMs,
        );
        await Promise.allSettled(
          followUps.map((session) => this.deliver(session)),
        );
      }
      await this.synchronize?.();
    })().finally(() => {
      if (this.#active === active) this.#active = undefined;
    });
    this.#active = active;
    return active;
  }
}
