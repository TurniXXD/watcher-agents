import { errorMessage } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';
import type { SocialTrendIntelligence } from './trends/runner.js';
import { nextSundayReminder } from './time.js';

type SchedulerTransport = {
  send(chatId: bigint, text: string): Promise<void>;
};

const previousWindow = (now: Date): Date =>
  new Date(now.getTime() - 8 * 24 * 60 * 60_000);

export class SocialsScheduler {
  #timer: NodeJS.Timeout | undefined;
  #active: Promise<void> | undefined;

  public constructor(
    private readonly options: {
      store: SocialsStore;
      trendIntelligence: SocialTrendIntelligence;
      transport: SchedulerTransport;
      intervalMs: number;
      defaultTimezone: string;
      defaultReminderTime: string;
      logger?: {
        error(data: unknown, message: string): void;
      };
    },
  ) {}

  public start(): void {
    if (this.#timer) return;
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
    const active = this.run(now).finally(() => {
      if (this.#active === active) this.#active = undefined;
    });
    this.#active = active;
    return active;
  }

  private async seed(now: Date): Promise<void> {
    for (const setting of await this.options.store.listSettings()) {
      const timezone = setting.timezone || this.options.defaultTimezone;
      const reminderTime =
        setting.sundayReminderTime || this.options.defaultReminderTime;
      const trendProfile = await this.options.trendIntelligence.ensureProfile(
        setting.ownerUserId,
      );
      if (trendProfile.enabled && trendProfile.nextRunAt) {
        await this.options.store.upsertScheduledJob({
          ownerUserId: setting.ownerUserId,
          chatId: setting.chatId,
          kind: 'DAILY_TRENDS',
          scheduledFor: trendProfile.nextRunAt,
        });
      }
      for (const scheduledFor of [
        nextSundayReminder(previousWindow(now), timezone, reminderTime),
        nextSundayReminder(now, timezone, reminderTime),
      ]) {
        await this.options.store.upsertScheduledJob({
          ownerUserId: setting.ownerUserId,
          chatId: setting.chatId,
          kind: 'SUNDAY_PLANNING',
          scheduledFor,
        });
      }
    }
  }

  private async run(now: Date): Promise<void> {
    await this.seed(now);
    const jobs = await this.options.store.claimDueJobs(now, [
      'DAILY_TRENDS',
      'SUNDAY_PLANNING',
    ]);
    for (const job of jobs) {
      try {
        if (job.kind === 'DAILY_TRENDS') {
          if (now.getTime() - job.scheduledFor.getTime() <= 12 * 60 * 60_000) {
            const report = await this.options.trendIntelligence.run({
              ownerUserId: job.ownerUserId,
              chatId: job.chatId,
              trigger: 'SCHEDULED',
              now,
            });
            if (report?.text) {
              await this.options.transport.send(job.chatId, report.text);
            }
          }
        } else if (
          job.kind === 'SUNDAY_PLANNING' &&
          now.getTime() - job.scheduledFor.getTime() <= 3 * 60 * 60_000
        ) {
          await this.options.transport.send(
            job.chatId,
            '📅 Je čas připravit obsah na další týden.\nPojďme projít, co jsi vytvořil, a naplánovat příspěvky na LinkedIn, Instagram, blog a newsletter.\n\n/socials_plan · /socials_ideas · /socials_history',
          );
        }
        await this.options.store.completeScheduledJob(job.id);
      } catch (error) {
        await this.options.store.failScheduledJob(job.id, errorMessage(error));
        this.options.logger?.error(
          { err: error, socialJobId: job.id, kind: job.kind },
          'Socials scheduled job failed',
        );
      }
    }
  }
}
