import { describe, expect, it, vi } from 'vitest';
import { InboundEmailAnalyzer } from '../inbound-email-analysis.js';
import { processInboundEmail } from '../inbound-email-service.js';
import type { InboundEmailMessage } from '../inbound-mailbox.js';

const message = (
  overrides: Partial<InboundEmailMessage> = {},
): InboundEmailMessage => ({
  eventId: 'sales:inbound-email:event-1',
  messageId: '<event-1@example.com>',
  receivedAt: new Date('2026-10-29T09:00:00.000Z'),
  from: { address: 'forms@vantuch.dev', name: 'Website form' },
  replyTo: [{ address: 'ada@example.com', name: 'Ada Lovelace' }],
  subject: 'Contact form: new project enquiry',
  text: 'I am interested in a web application project and would like a quote.',
  automated: true,
  contactFormHint: true,
  ...overrides,
});

describe('inbound email analysis', () => {
  it('uses Reply-To for contact-form leads and does not discard the automated form envelope', async () => {
    const analysis = await new InboundEmailAnalyzer().analyze(
      message(),
      'hello@vantuch.dev',
    );

    expect(analysis).toMatchObject({
      classification: 'LEAD',
      source: 'CONTACT_FORM',
      contactEmail: 'ada@example.com',
      contactName: 'Ada Lovelace',
      analysisMethod: 'DETERMINISTIC',
    });
  });

  it('rejects automated bulk and transactional mail', async () => {
    const analysis = await new InboundEmailAnalyzer().analyze(
      message({
        from: { address: 'newsletter@example.com' },
        replyTo: [],
        subject: 'Newsletter',
        text: 'Unsubscribe from this newsletter.',
        contactFormHint: false,
      }),
      'hello@vantuch.dev',
    );

    expect(analysis.classification).toBe('NON_LEAD');
    expect(analysis.riskSignals).toContain('Automated or bulk message');
  });

  it('rejects unsolicited service pitches without Ollama', async () => {
    const analysis = await new InboundEmailAnalyzer().analyze(
      message({
        from: { address: 'seller@example.com', name: 'Cold Seller' },
        replyTo: [],
        subject: 'SEO proposal',
        text: 'We offer SEO and link building services to grow your business.',
        automated: false,
        contactFormHint: false,
      }),
      'hello@vantuch.dev',
    );

    expect(analysis.classification).toBe('NON_LEAD');
    expect(analysis.riskSignals).toContain(
      'Unsolicited pitch or job application',
    );
  });

  it('accepts only contact addresses grounded in the received message', async () => {
    const generateStructured = vi.fn(async () => ({
      classification: 'LEAD' as const,
      confidence: 0.95,
      source: 'EMAIL' as const,
      contactEmail: 'invented@example.net',
      contactName: 'Ada Lovelace',
      companyName: 'Analytical Engines',
      jobTitle: 'Founder',
      phone: null,
      intent: 'Web application enquiry',
      summary: 'The sender requests a web application quote.',
      requestedServices: ['Web application development'],
      riskSignals: [],
    }));
    const analysis = await new InboundEmailAnalyzer({
      generateStructured,
    } as never).analyze(
      message({ automated: false, contactFormHint: false }),
      'hello@vantuch.dev',
    );

    expect(analysis.contactEmail).toBe('ada@example.com');
    expect(analysis.analysisMethod).toBe('AI');
  });
});

describe('inbound email CRM processing', () => {
  it('upserts a Person and Note before enqueueing an idempotent Telegram alert', async () => {
    const operations: string[] = [];
    const store = {
      hasWebhook: vi.fn(async () => null),
      recordWebhook: vi.fn(async () => {
        operations.push('record');
        return {};
      }),
    };
    const twenty = {
      upsertPerson: vi.fn(async () => {
        operations.push('person');
        return { id: 'person-1' };
      }),
      recordInteraction: vi.fn(async () => {
        operations.push('note');
        return { id: 'note-1' };
      }),
    };
    let enqueued: unknown;
    const enqueue = vi.fn(async (payload: unknown) => {
      enqueued = payload;
      operations.push('enqueue');
    });

    await expect(
      processInboundEmail({
        message: message(),
        mailboxAddress: 'hello@vantuch.dev',
        analyzer: new InboundEmailAnalyzer(),
        store,
        twenty,
        crmPublicUrl: 'https://crm.vantuch.dev',
        enqueue,
      }),
    ).resolves.toBe('created');

    expect(twenty.upsertPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        source: 'MAILBOX_CONTACT_FORM',
        externalId: 'sales:inbound-email:event-1',
      }),
    );
    expect(twenty.recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'person-1' }),
    );
    expect(enqueued).toMatchObject({
      record: {
        id: 'person-1',
        crmUrl: 'https://crm.vantuch.dev/objects/people/person-1',
      },
    });
    expect(operations).toEqual(['person', 'note', 'enqueue', 'record']);
  });

  it('does not touch CRM or Telegram for a duplicate or clear non-lead', async () => {
    const twenty = {
      upsertPerson: vi.fn(),
      recordInteraction: vi.fn(),
    };
    const enqueue = vi.fn();
    const duplicateStore = {
      hasWebhook: vi.fn(async () => ({ id: 'existing' })),
      recordWebhook: vi.fn(),
    };
    await expect(
      processInboundEmail({
        message: message(),
        mailboxAddress: 'hello@vantuch.dev',
        analyzer: new InboundEmailAnalyzer(),
        store: duplicateStore,
        twenty,
        enqueue,
      }),
    ).resolves.toBe('duplicate');

    const ignoredStore = {
      hasWebhook: vi.fn(async () => null),
      recordWebhook: vi.fn(async () => ({})),
    };
    await expect(
      processInboundEmail({
        message: message({
          from: { address: 'newsletter@example.com' },
          replyTo: [],
          subject: 'Newsletter',
          text: 'Unsubscribe from this newsletter.',
          contactFormHint: false,
        }),
        mailboxAddress: 'hello@vantuch.dev',
        analyzer: new InboundEmailAnalyzer(),
        store: ignoredStore,
        twenty,
        enqueue,
      }),
    ).resolves.toBe('ignored');
    expect(twenty.upsertPerson).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(ignoredStore.recordWebhook).toHaveBeenCalledWith(
      expect.any(String),
      'sales.inbound_email.ignored',
      expect.objectContaining({ classification: 'NON_LEAD' }),
      expect.any(Date),
    );
  });
});
