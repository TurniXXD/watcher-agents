import { describe, expect, it, vi } from 'vitest';
import {
  acceptCrmInboundLead,
  crmInboundLeadSchema,
  enqueueCrmInboundLead,
  renderCrmInboundLead,
  salesInboundLeadKind,
  type CrmInboundLead,
} from '../crm-inbound-lead.js';

const payload: CrmInboundLead = {
  eventId: 'twenty:person.created:workspace:person-1',
  occurredAt: '2026-10-24T09:30:00.000Z',
  source: 'CONTACT_FORM',
  record: {
    id: 'person-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+420 123 456 789',
    companyName: 'Analytical Engines',
    jobTitle: 'Founder',
  },
};

describe('CRM inbound lead notifications', () => {
  it('renders a compact Czech notification with the source and CRM identity', () => {
    expect(renderCrmInboundLead(payload)).toBe(
      [
        '🔔 Nový příchozí lead v CRM',
        'Zdroj: kontaktní formulář',
        'Kontakt: Ada Lovelace',
        'E-mail: ada@example.com',
        'Telefon: +420 123 456 789',
        'Firma: Analytical Engines',
        'Pozice: Founder',
        'CRM ID: person-1',
      ].join('\n'),
    );
  });

  it('accepts only explicit contact-form and email origins', () => {
    expect(() =>
      crmInboundLeadSchema.parse({ ...payload, source: 'MANUAL' }),
    ).toThrow();
    expect(
      crmInboundLeadSchema.parse({ ...payload, source: 'EMAIL' }).source,
    ).toBe('EMAIL');
  });

  it('queues one durable idempotent message per authorized operator', async () => {
    const enqueueMany = vi.fn(async () => undefined);
    await enqueueCrmInboundLead(payload, new Set([12, 34]), { enqueueMany });

    expect(enqueueMany).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: salesInboundLeadKind,
        deduplicationKey: `${payload.eventId}:12`,
        chatId: 12n,
      }),
      expect.objectContaining({
        kind: salesInboundLeadKind,
        deduplicationKey: `${payload.eventId}:34`,
        chatId: 34n,
      }),
    ]);
  });

  it('records the event after durable enqueue and ignores redelivery', async () => {
    const operations: string[] = [];
    const store = {
      hasWebhook: vi.fn(async () => null),
      recordWebhook: vi.fn(async () => {
        operations.push('record');
        return {};
      }),
    } as unknown as Parameters<typeof acceptCrmInboundLead>[1];
    const enqueue = vi.fn(async () => {
      operations.push('enqueue');
    });

    await expect(acceptCrmInboundLead(payload, store, enqueue)).resolves.toBe(
      'accepted',
    );
    expect(operations).toEqual(['enqueue', 'record']);

    const duplicateStore = {
      hasWebhook: vi.fn(async () => ({ id: payload.eventId })),
      recordWebhook: vi.fn(),
    } as unknown as Parameters<typeof acceptCrmInboundLead>[1];
    await expect(
      acceptCrmInboundLead(payload, duplicateStore, enqueue),
    ).resolves.toBe('duplicate');
    expect(duplicateStore.recordWebhook).not.toHaveBeenCalled();
  });
});
