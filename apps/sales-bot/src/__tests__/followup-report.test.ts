import { describe, expect, it, vi } from 'vitest';
import {
  enqueueFollowupReports,
  followupSlotAt,
  renderFollowupReport,
  salesFollowupKind,
} from '../followup-report.js';

const timezone = 'Europe/Prague';
const atPragueEvening = (day: string) => new Date(`${day}T18:00:00.000Z`);

const event = (at: string, overrides: Record<string, unknown> = {}) => ({
  id: at,
  event: 'email.sent',
  payload: {},
  occurredAt: new Date(at),
  leadId: 'lead-1',
  processedAt: new Date(at),
  lead: {
    id: 'lead-1',
    companyName: 'Acme',
    email: 'hello@acme.example',
    phone: '+420 777 123 456',
    websiteUrl: 'https://acme.example',
    contactSourceUrl: 'https://acme.example/contact',
    stage: 'CONTACTED',
    campaign: { name: 'Web audit' },
    ...overrides,
  },
});

type SentEvent = Parameters<typeof renderFollowupReport>[1][number];

describe('sales follow-up report', () => {
  it('sends Mon–Thu only after the configured Prague time', () => {
    expect(
      followupSlotAt(new Date('2026-10-01T17:59:00Z'), timezone, '20:00'),
    ).toBeUndefined();
    expect(
      followupSlotAt(new Date('2026-10-01T18:00:00Z'), timezone, '20:00'),
    ).toEqual({
      date: '2026-10-01',
      fromDate: '2026-10-01',
      nextCallDate: '2026-10-02',
      sunday: false,
    });
  });

  it('never schedules Friday or Saturday and groups Friday–Sunday on Sunday', () => {
    expect(
      followupSlotAt(atPragueEvening('2026-10-02'), timezone, '20:00'),
    ).toBeUndefined();
    expect(
      followupSlotAt(atPragueEvening('2026-10-03'), timezone, '20:00'),
    ).toBeUndefined();
    expect(
      followupSlotAt(atPragueEvening('2026-10-04'), timezone, '20:00'),
    ).toEqual({
      date: '2026-10-04',
      fromDate: '2026-10-02',
      nextCallDate: '2026-10-05',
      sunday: true,
    });
  });

  it('uses the local day around UTC midnight and DST', () => {
    expect(
      followupSlotAt(new Date('2026-10-25T19:00:00Z'), timezone, '20:00'),
    ).toMatchObject({ date: '2026-10-25', fromDate: '2026-10-23' });
    expect(
      followupSlotAt(new Date('2026-10-04T22:30:00Z'), timezone, '00:00'),
    ).toMatchObject({ date: '2026-10-05', sunday: false });
  });

  it('deduplicates repeated sends to one contact and marks negative replies', () => {
    const slot = followupSlotAt(
      atPragueEvening('2026-10-04'),
      timezone,
      '20:00',
    )!;
    const text = renderFollowupReport(
      slot,
      [
        event('2026-10-01T12:00:00Z'),
        event('2026-10-02T12:00:00Z', { stage: 'UNSUBSCRIBED' }),
        event('2026-10-03T12:00:00Z', { stage: 'UNSUBSCRIBED' }),
      ] as unknown as SentEvent[],
      timezone,
    );
    expect(text).toContain('2026-10-02–2026-10-04 (pá–ne)');
    expect(text).toContain('1 kontaktů');
    expect(text).toContain('2 odeslané e-maily');
    expect(text).toContain('Telefon: +420 777 123 456');
    expect(text).toContain('NEVOLAT');
    expect(text).not.toContain('3 odeslané e-maily');
  });

  it('enqueues one durable report per authorized user and date', async () => {
    const hasMessage = vi.fn().mockResolvedValue(false);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const listSentEmailEvents = vi
      .fn()
      .mockResolvedValue([event('2026-10-01T12:00:00Z')]);
    const count = await enqueueFollowupReports(
      atPragueEvening('2026-10-01'),
      timezone,
      '20:00',
      new Set([101, 202]),
      { listSentEmailEvents },
      { hasMessage, enqueueMany },
    );
    expect(count).toBe(2);
    expect(enqueueMany).toHaveBeenCalledOnce();
    const messages = enqueueMany.mock.calls[0]?.[0] as {
      kind: string;
      deduplicationKey: string;
      body: string;
    }[];
    expect(messages.map((message) => message.deduplicationKey)).toEqual([
      '101:2026-10-01:0',
      '202:2026-10-01:0',
    ]);
    expect(messages[0]?.kind).toBe(salesFollowupKind);
    expect(messages[0]?.body).toContain('hello@acme.example');
  });

  it('skips an already queued report and does not query sends', async () => {
    const listSentEmailEvents = vi.fn();
    const enqueueMany = vi.fn();
    const count = await enqueueFollowupReports(
      atPragueEvening('2026-10-01'),
      timezone,
      '20:00',
      new Set([101]),
      { listSentEmailEvents },
      {
        hasMessage: vi.fn().mockResolvedValue(true),
        enqueueMany,
      },
    );
    expect(count).toBe(0);
    expect(listSentEmailEvents).not.toHaveBeenCalled();
    expect(enqueueMany).not.toHaveBeenCalled();
  });
});
