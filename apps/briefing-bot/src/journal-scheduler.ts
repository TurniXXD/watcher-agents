import type {
  JournalSessionRecord,
  JournalSessionStore,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';

export class JournalScheduler {
  #timer: NodeJS.Timeout | undefined;
  #active: Promise<void> | undefined;

  public constructor(
    private readonly store: JournalSessionStore,
    private readonly deliverReminder: (
      session: JournalSessionRecord,
    ) => Promise<void>,
    private readonly synchronize: (
      session: JournalSessionRecord,
    ) => Promise<void>,
    private readonly options: {
      enabled: boolean;
      reminderTime: string;
      timezone: string;
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
      const reminders = await this.store.claimDueReminders(
        now,
        this.options.reminderTime,
        this.options.timezone,
      );
      for (const session of reminders) {
        try {
          await this.deliverReminder(session);
          await this.store.markReminderSent(session.id, now);
        } catch (error) {
          await this.store.releaseReminder(session.id);
          this.options.logger?.error(
            { err: error, journalSessionId: session.id },
            'Evening journal reminder failed',
          );
        }
      }
      const pending = await this.store.listDueSync(now);
      await Promise.allSettled(
        pending.map((session) => this.synchronize(session)),
      );
    })().finally(() => {
      if (this.#active === active) this.#active = undefined;
    });
    this.#active = active;
    return active;
  }
}
