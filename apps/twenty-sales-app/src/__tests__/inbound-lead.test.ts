import { describe, expect, it } from 'vitest';
import {
  buildInboundLeadPayload,
  classifyInboundLead,
  type TwentyPersonRecord,
} from '../inbound-lead.js';

describe('Twenty inbound lead classification', () => {
  it('accepts people created by incoming email even for a connected member', () => {
    expect(
      classifyInboundLead(
        { createdBy: { source: 'EMAIL', workspaceMemberId: 'member-1' } },
        { workspaceMemberId: 'member-1' },
      ),
    ).toBe('EMAIL');
  });

  it('accepts an explicitly tagged contact-form API record', () => {
    expect(
      classifyInboundLead(
        { leadSource: 'website contact form', createdBy: { source: 'API' } },
        {},
      ),
    ).toBe('CONTACT_FORM');
  });

  it('rejects manual records and Sales Bot imports', () => {
    expect(
      classifyInboundLead(
        { leadSource: 'CONTACT_FORM', createdBy: { source: 'MANUAL' } },
        { workspaceMemberId: 'operator' },
      ),
    ).toBeUndefined();
    expect(
      classifyInboundLead(
        { leadSource: 'ARES', createdBy: { source: 'API' } },
        {},
      ),
    ).toBeUndefined();
  });

  it('maps only bounded contact fields into the webhook payload', () => {
    const person: TwentyPersonRecord = {
      name: { firstName: ' Ada ', lastName: 'Lovelace' },
      emails: { primaryEmail: 'ada@example.com' },
      phones: {
        primaryPhoneCallingCode: '+420',
        primaryPhoneNumber: '123456789',
      },
      company: { name: 'Analytical Engines' },
      jobTitle: 'Founder',
    };
    expect(
      buildInboundLeadPayload({
        eventId: 'event-1',
        occurredAt: '2026-10-24T09:30:00.000Z',
        source: 'EMAIL',
        recordId: 'person-1',
        person,
      }),
    ).toEqual({
      eventId: 'event-1',
      occurredAt: '2026-10-24T09:30:00.000Z',
      source: 'EMAIL',
      record: {
        id: 'person-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+420 123456789',
        companyName: 'Analytical Engines',
        jobTitle: 'Founder',
      },
    });
  });
});
