import { computeNextRun, errorMessage } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';
import type { SocialsService } from './service.js';
import { formatPragueDateTime, nextSundayReminder } from './time.js';

type SchedulerTransport = {
  send(chatId: bigint, text: string): Promise<void>;
};

const previousWindow = (now: Date): Date =>
  new Date(now.getTime() - 8 * 24 * 60 * 60_000);

const payloadRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export class SocialsScheduler {
  #timer: NodeJS.Timeout | undefined;
  #active: Promise<void> | undefined;

  public constructor(
    private readonly options: {
      store: SocialsStore;
      service: SocialsService;
      transport: SchedulerTransport;
      intervalMs: number;
      defaultTimezone: string;
      defaultReminderTime: string;
      logger?: {
        info(data: unknown, message: string): void;
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
    const settings = await this.options.store.listSettings();
    for (const setting of settings) {
      const timezone = setting.timezone || this.options.defaultTimezone;
      const reminderTime =
        setting.sundayReminderTime || this.options.defaultReminderTime;
      const lastSunday = nextSundayReminder(
        previousWindow(now),
        timezone,
        reminderTime,
      );
      const nextSunday = nextSundayReminder(now, timezone, reminderTime);
      await Promise.all(
        [lastSunday, nextSunday].map((scheduledFor) =>
          this.options.store.upsertScheduledJob({
            ownerUserId: setting.ownerUserId,
            chatId: setting.chatId,
            kind: 'SUNDAY_PLANNING',
            scheduledFor,
          }),
        ),
      );
      if (setting.mondayNetworkingReminder) {
        const lastMonday = computeNextRun(
          '0 9 * * 1',
          timezone,
          previousWindow(now),
        );
        const nextMonday = computeNextRun('0 9 * * 1', timezone, now);
        await Promise.all(
          [lastMonday, nextMonday].map((scheduledFor) =>
            this.options.store.upsertScheduledJob({
              ownerUserId: setting.ownerUserId,
              chatId: setting.chatId,
              kind: 'MONDAY_NETWORKING',
              scheduledFor,
            }),
          ),
        );
      }
      const attendances = await this.options.store.listAttendances(
        setting.ownerUserId,
      );
      for (const attendance of attendances) {
        if (!['INTERESTED', 'REGISTERED'].includes(attendance.status)) continue;
        if (attendance.event.startAt.getTime() > now.getTime()) {
          await this.options.store.upsertScheduledJob({
            ownerUserId: setting.ownerUserId,
            chatId: setting.chatId,
            kind: 'PRE_EVENT',
            scheduledFor: new Date(
              attendance.event.startAt.getTime() - 24 * 60 * 60_000,
            ),
            payload: { attendanceId: attendance.id },
          });
        }
        const eventEnd = attendance.event.endAt ?? attendance.event.startAt;
        await this.options.store.upsertScheduledJob({
          ownerUserId: setting.ownerUserId,
          chatId: setting.chatId,
          kind: 'POST_EVENT',
          scheduledFor: new Date(eventEnd.getTime() + 2 * 60 * 60_000),
          payload: { attendanceId: attendance.id },
        });
      }
      const contacts = await this.options.store.listContacts(
        setting.ownerUserId,
      );
      for (const contact of contacts) {
        for (const followUp of contact.followUps) {
          await this.options.store.upsertScheduledJob({
            ownerUserId: setting.ownerUserId,
            chatId: setting.chatId,
            kind: `FOLLOW_UP:${followUp.id}`,
            scheduledFor: followUp.dueAt,
            payload: { followUpId: followUp.id },
          });
        }
      }
    }
  }

  private async run(now: Date): Promise<void> {
    await this.seed(now);
    const jobs = await this.options.store.claimDueJobs(now);
    for (const job of jobs) {
      try {
        await this.execute(job, now);
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

  private async execute(
    job: Awaited<ReturnType<SocialsStore['claimDueJobs']>>[number],
    now: Date,
  ): Promise<void> {
    if (
      ['SUNDAY_PLANNING', 'MONDAY_NETWORKING'].includes(job.kind) &&
      now.getTime() - job.scheduledFor.getTime() > 3 * 60 * 60_000
    ) {
      return;
    }
    if (job.kind === 'SUNDAY_PLANNING') {
      const events = await this.options.service.discoverEvents(
        job.ownerUserId,
        job.chatId,
        { now },
      );
      const eventLines = events.length
        ? events
            .map(
              (event) =>
                `• ${formatPragueDateTime(event.startAt)} — ${event.title} (${event.city ?? 'místo neuvedeno'}, ${event.priceStatus === 'FREE' ? 'zdarma' : event.priceStatus === 'PAID' ? 'placené' : 'cena neověřena'})`,
            )
            .join('\n')
        : 'Nebyla nalezena žádná dostatečně ověřená akce. Lze přidat vlastní URL přes /socials_event_add.';
      await this.options.transport.send(
        job.chatId,
        `📅 Je čas připravit obsah na další týden.\nPojďme projít, co jsi vytvořil, a naplánovat příspěvky na LinkedIn, Instagram, blog a newsletter.\n\n🤝 Networking na příští týden\n${eventLines}\n\n/socials_plan · /socials_ideas · /socials_history · /socials_networking`,
      );
      return;
    }
    if (job.kind.startsWith('FOLLOW_UP:')) {
      const followUpId = payloadRecord(job.payload).followUpId;
      if (typeof followUpId !== 'string') return;
      const followUp = await this.options.store.getFollowUp(
        job.ownerUserId,
        followUpId,
      );
      if (!followUp || followUp.status !== 'OPEN') return;
      await this.options.transport.send(
        job.chatId,
        `👥 Připomínka follow-upu\n${followUp.contact.displayName}${followUp.contact.organization ? ` · ${followUp.contact.organization}` : ''}\n${followUp.title}\n\nBot kontakt sám neosloví. Až to vyřídíš: /socials_contacts done ${followUp.id}`,
      );
      return;
    }
    const attendances = await this.options.store.listAttendances(
      job.ownerUserId,
    );
    if (job.kind === 'MONDAY_NETWORKING') {
      const hasSelection = attendances.some(
        (attendance) =>
          ['INTERESTED', 'REGISTERED'].includes(attendance.status) &&
          attendance.event.startAt.getTime() > now.getTime(),
      );
      if (!hasSelection) {
        await this.options.transport.send(
          job.chatId,
          '🤝 Ještě nemáš vybranou networkingovou akci na tento týden. Pokud chceš, otevři /socials_networking. Připomínku můžeš ignorovat.',
        );
      }
      return;
    }
    const attendanceId = payloadRecord(job.payload).attendanceId;
    const attendance = attendances.find(
      (candidate) => candidate.id === attendanceId,
    );
    if (!attendance) return;
    if (job.kind === 'PRE_EVENT') {
      await this.options.transport.send(
        job.chatId,
        `🤝 Připomínka akce\n${attendance.event.title}\n${formatPragueDateTime(attendance.event.startAt)} · ${attendance.event.venue ?? attendance.event.city ?? 'místo neověřeno'}\n${attendance.event.registrationUrl ?? attendance.event.canonicalUrl ?? ''}\n\nVolitelný cíl: poznat několik lidí a vést jeden nebo dva smysluplné rozhovory.`,
      );
    } else if (job.kind === 'POST_EVENT') {
      await this.options.transport.send(
        job.chatId,
        `Byl jsi na akci „${attendance.event.title}“? Potvrď účast přes /socials_networking. Účast se nikdy neoznačí automaticky.`,
      );
    }
  }
}
