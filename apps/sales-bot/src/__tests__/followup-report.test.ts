import { describe, expect, it, vi } from 'vitest';
import {
  enqueueFollowupReports,
  followupSlotAt,
  renderFollowupReport,
  salesFollowupKind,
} from '../followup-report.js';

const timezone = 'Europe/Prague';
const atPragueEvening = (day: string) => new Date(`${day}T18:00:00.000Z`);

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  companyName: 'Acme',
  email: 'hello@acme.example',
  phone: '+420 777 123 456',
  websiteUrl: 'https://acme.example',
  phoneSourceUrl: 'https://acme.example/contact',
  finalScore: 82,
  stage: 'QUALIFIED',
  campaign: { name: 'Web audit' },
  ...overrides,
});

type Candidate = Parameters<typeof renderFollowupReport>[1][number];

describe('sales follow-up report', () => {
  it('sends Mon–Thu only after the configured Prague time', () => {
    expect(
      followupSlotAt(new Date('2026-10-01T17:59:00Z'), timezone, '20:00'),
    ).toBeUndefined();
    expect(
      followupSlotAt(new Date('2026-10-01T18:00:00Z'), timezone, '20:00'),
    ).toEqual({
      date: '2026-10-01',
      nextCallDate: '2026-10-02',
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
      nextCallDate: '2026-10-05',
    });
  });

  it('uses the local day around UTC midnight and DST', () => {
    expect(
      followupSlotAt(new Date('2026-10-25T19:00:00Z'), timezone, '20:00'),
    ).toMatchObject({ date: '2026-10-25', nextCallDate: '2026-10-26' });
    expect(
      followupSlotAt(new Date('2026-10-04T22:30:00Z'), timezone, '00:00'),
    ).toMatchObject({ date: '2026-10-05', nextCallDate: '2026-10-06' });
  });

  it('renders researched phone contacts without relying on sent email events', () => {
    const slot = followupSlotAt(
      atPragueEvening('2026-10-04'),
      timezone,
      '20:00',
    )!;
    const text = renderFollowupReport(slot, [
      candidate(),
      candidate({
        id: 'lead-2',
        companyName: 'Beta',
        email: null,
        phone: '+420 222 333 444',
      }),
    ] as unknown as Candidate[]);
    expect(text).toContain('Cold cally na 2026-10-05');
    expect(text).toContain('Veřejné telefonní kontakty: 2');
    expect(text).toContain('Telefon: +420 777 123 456');
    expect(text).toContain('Zdroj telefonu: https://acme.example/contact');
    expect(text).toContain('82 bodů');
    expect(text).not.toContain('email.sent');
    expect(text).not.toContain('Quickly');
  });

  it('explains how to populate an empty call list', () => {
    const text = renderFollowupReport(
      { date: '2026-10-01', nextCallDate: '2026-10-02' },
      [],
    );
    expect(text).toContain('Veřejné telefonní kontakty: 0');
    expect(text).toContain('/sales_find');
    expect(text).toContain('/sales_run');
    expect(text).not.toContain('email.sent');
  });

  it('enqueues one durable report per authorized user and date', async () => {
    const hasMessage = vi.fn().mockResolvedValue(false);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const listCallCandidates = vi.fn().mockResolvedValue([candidate()]);
    const count = await enqueueFollowupReports(
      atPragueEvening('2026-10-01'),
      timezone,
      '20:00',
      new Set([101, 202]),
      { listCallCandidates },
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
    expect(listCallCandidates).toHaveBeenCalledWith(20);
  });

  it('skips an already queued report and does not query call candidates', async () => {
    const listCallCandidates = vi.fn();
    const enqueueMany = vi.fn();
    const count = await enqueueFollowupReports(
      atPragueEvening('2026-10-01'),
      timezone,
      '20:00',
      new Set([101]),
      { listCallCandidates },
      {
        hasMessage: vi.fn().mockResolvedValue(true),
        enqueueMany,
      },
    );
    expect(count).toBe(0);
    expect(listCallCandidates).not.toHaveBeenCalled();
    expect(enqueueMany).not.toHaveBeenCalled();
  });
});
