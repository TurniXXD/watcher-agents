import { computeNextRun, errorMessage } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';
import type {
  NetworkContact,
  NetworkRepository,
} from '@watcher/contact-network';
import {
  buildContactReminderJobs,
  canonicalContactMetDate,
  contactReminderJobPrefix,
  contactReminderLead,
  contactReminderPayloadSchema,
} from './contact-reminders.js';
import { formatLocalDateTime } from './time.js';

type SchedulerTransport = {
  send(chatId: bigint, text: string): Promise<void>;
};

const payloadRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const networkingJobKinds = [
  'MONDAY_NETWORKING',
  'PRE_EVENT',
  'POST_EVENT',
] as const;

export class NetworkingScheduler {
  #timer: NodeJS.Timeout | undefined;
  #active: Promise<void> | undefined;
  #nextContactSyncAt = 0;

  public constructor(
    private readonly options: {
      store: SocialsStore;
      transport: SchedulerTransport;
      intervalMs: number;
      defaultTimezone: string;
      contacts?: Pick<NetworkRepository, 'getContacts'>;
      contactSyncIntervalMs?: number;
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
    const active = this.run(now)
      .catch((error: unknown) => {
        this.options.logger?.error(
          { err: error },
          'Networking scheduler tick failed',
        );
      })
      .finally(() => {
        if (this.#active === active) this.#active = undefined;
      });
    this.#active = active;
    return active;
  }

  private async loadContactSnapshot(
    now: Date,
  ): Promise<Map<string, NetworkContact> | undefined> {
    if (!this.options.contacts || now.getTime() < this.#nextContactSyncAt)
      return undefined;
    this.#nextContactSyncAt =
      now.getTime() + (this.options.contactSyncIntervalMs ?? 15 * 60_000);
    try {
      const contacts = await this.options.contacts.getContacts();
      return new Map(contacts.map((contact) => [contact.id, contact]));
    } catch (error) {
      this.options.logger?.error(
        { err: error },
        'Networking contact reminder sync failed',
      );
      return undefined;
    }
  }

  private async seed(
    now: Date,
  ): Promise<Map<string, NetworkContact> | undefined> {
    const settings = await this.options.store.listSettings();
    const contactSnapshot =
      settings.length > 0 ? await this.loadContactSnapshot(now) : undefined;
    for (const setting of settings) {
      const timezone = setting.timezone || this.options.defaultTimezone;
      if (setting.mondayNetworkingReminder) {
        await this.options.store.upsertScheduledJob({
          ownerUserId: setting.ownerUserId,
          chatId: setting.chatId,
          kind: 'MONDAY_NETWORKING',
          scheduledFor: computeNextRun('0 9 * * 1', timezone, now),
        });
      }
      for (const attendance of await this.options.store.listAttendances(
        setting.ownerUserId,
      )) {
        if (!['INTERESTED', 'REGISTERED'].includes(attendance.status)) continue;
        if (attendance.event.startAt > now) {
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
        await this.options.store.upsertScheduledJob({
          ownerUserId: setting.ownerUserId,
          chatId: setting.chatId,
          kind: 'POST_EVENT',
          scheduledFor: new Date(
            (attendance.event.endAt ?? attendance.event.startAt).getTime() +
              2 * 60 * 60_000,
          ),
          payload: { attendanceId: attendance.id },
        });
      }
      for (const contact of await this.options.store.listContacts(
        setting.ownerUserId,
      )) {
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
      for (const contact of contactSnapshot?.values() ?? []) {
        for (const reminder of buildContactReminderJobs({
          contact,
          now,
          timezone,
        })) {
          await this.options.store.upsertScheduledJob({
            ownerUserId: setting.ownerUserId,
            chatId: setting.chatId,
            ...reminder,
          });
        }
      }
    }
    return contactSnapshot;
  }

  private async run(now: Date): Promise<void> {
    const contactSnapshot = await this.seed(now);
    const jobs = await this.options.store.claimDueJobs(
      now,
      networkingJobKinds,
      ['FOLLOW_UP:'],
    );
    if (contactSnapshot) {
      jobs.push(
        ...(await this.options.store.claimDueJobs(now, undefined, [
          contactReminderJobPrefix,
        ])),
      );
    }
    for (const job of jobs) {
      try {
        await this.execute(job, now, contactSnapshot);
        await this.options.store.completeScheduledJob(job.id);
      } catch (error) {
        await this.options.store.failScheduledJob(job.id, errorMessage(error));
        this.options.logger?.error(
          { err: error, networkingJobId: job.id, kind: job.kind },
          'Networking scheduled job failed',
        );
      }
    }
  }

  private async execute(
    job: Awaited<ReturnType<SocialsStore['claimDueJobs']>>[number],
    now: Date,
    contactSnapshot: Map<string, NetworkContact> | undefined,
  ): Promise<void> {
    if (job.kind.startsWith(contactReminderJobPrefix)) {
      const payload = contactReminderPayloadSchema.safeParse(job.payload);
      if (!payload.success || !contactSnapshot) return;
      const contact = contactSnapshot.get(payload.data.contactId);
      if (
        !contact?.active ||
        canonicalContactMetDate(contact.metDate) !== payload.data.metDate
      )
        return;
      await this.options.transport.send(
        job.chatId,
        `🤝 Připomeň se kontaktu\n${contactReminderLead(payload.data.milestone)} jsi poznal kontakt ${contact.name}${contact.metAt ? ` · ${contact.metAt}` : ''}.\n\nJe čas se ozvat a navázat na vaše setkání.`,
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
        `👥 Připomínka follow-upu\n${followUp.contact.displayName}${followUp.contact.organization ? ` · ${followUp.contact.organization}` : ''}\n${followUp.title}\n\nPo vyřízení: /network_event_contacts done ${followUp.id}`,
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
          attendance.event.startAt > now,
      );
      if (!hasSelection) {
        await this.options.transport.send(
          job.chatId,
          '🤝 Na tento týden ještě nemáš vybranou akci. Doporučení otevřeš přes /networking.',
        );
      }
      return;
    }
    const attendanceId = payloadRecord(job.payload).attendanceId;
    const attendance = attendances.find((item) => item.id === attendanceId);
    if (!attendance) return;
    if (job.kind === 'PRE_EVENT') {
      await this.options.transport.send(
        job.chatId,
        `🤝 Zítra: ${attendance.event.title}\n${formatLocalDateTime(attendance.event.startAt, attendance.event.timezone)} · ${attendance.event.venue ?? attendance.event.city ?? 'místo neověřeno'}\n${attendance.event.registrationUrl ?? attendance.event.canonicalUrl ?? ''}`,
      );
    } else if (job.kind === 'POST_EVENT') {
      await this.options.transport.send(
        job.chatId,
        `Byl jsi na akci „${attendance.event.title}“? Stav účasti uprav přes /networking. Účast se nikdy nepotvrzuje automaticky.`,
      );
    }
  }
}
