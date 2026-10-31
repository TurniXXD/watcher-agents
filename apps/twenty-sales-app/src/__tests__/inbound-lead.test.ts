import { describe, expect, it } from 'vitest';
import {
  buildInboundNotePayload,
  buildInboundLeadPayload,
  classifyInboundLead,
  isWatcherManagedNote,
  type TwentyPersonRecord,
} from '../inbound-lead.js';

describe('Twenty inbound lead classification', () => {
  it('accepts people created by incoming email even for a connected member', () => {
    expect(
      classifyInboundLead({
        createdBy: { source: 'EMAIL', workspaceMemberId: 'member-1' },
      }),
    ).toBe('EMAIL');
  });

  it('accepts an explicitly tagged contact-form API record', () => {
    expect(
      classifyInboundLead({
        leadSource: 'website contact form',
        createdBy: { source: 'API' },
      }),
    ).toBe('CONTACT_FORM');
  });

  it('notifies manual and otherwise unclassified CRM people', () => {
    expect(
      classifyInboundLead({
        leadSource: 'CONTACT_FORM',
        createdBy: { source: 'MANUAL' },
      }),
    ).toBe('CONTACT_FORM');
    expect(classifyInboundLead({ createdBy: { source: 'API' } })).toBe('CRM');
  });

  it('rejects Watcher-managed records that already own their notification', () => {
    expect(
      classifyInboundLead({
        leadSource: 'ARES',
        createdBy: { source: 'API' },
      }),
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
      eventType: 'PERSON_CREATED',
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

  it('maps every ordinary CRM note to its own bounded notification event', () => {
    expect(
      buildInboundNotePayload({
        eventId: 'twenty:note.created:workspace:note-1',
        occurredAt: '2026-10-31T09:30:00.000Z',
        recordId: 'note-1',
        note: {
          title: 'Contact form: another enquiry',
          bodyV2: { markdown: 'Please call me about another project.' },
        },
      }),
    ).toEqual({
      eventId: 'twenty:note.created:workspace:note-1',
      occurredAt: '2026-10-31T09:30:00.000Z',
      eventType: 'NOTE_CREATED',
      source: 'CRM',
      record: {
        id: 'note-1',
        subject: 'Contact form: another enquiry',
        summary: 'Please call me about another project.',
      },
    });
    expect(
      isWatcherManagedNote({
        title: '[sales-interaction:sales:inbound-email:event-1] Inbound',
      }),
    ).toBe(true);
    expect(isWatcherManagedNote({ title: 'Contact form enquiry' })).toBe(false);
  });
});
