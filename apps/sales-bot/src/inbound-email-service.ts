import type { WatcherLogger } from '@watcher/core';
import {
  acceptCrmInboundLead,
  type CrmInboundLead,
} from './crm-inbound-lead.js';
import type {
  InboundEmailAnalysis,
  InboundEmailAnalyzer,
} from './inbound-email-analysis.js';
import {
  readInboundMailbox,
  type InboundEmailMessage,
  type InboundMailboxConfiguration,
} from './inbound-mailbox.js';
import type { TwentyIntegration } from './integrations/twenty/index.js';

type InboundStore = {
  hasWebhook: (id: string) => PromiseLike<{ id: string } | null>;
  recordWebhook: (
    id: string,
    event: string,
    payload: unknown,
    occurredAt: Date,
    leadId?: string,
  ) => PromiseLike<unknown>;
};
type TwentyInboundClient = Pick<
  TwentyIntegration,
  'upsertPerson' | 'recordInteraction'
>;

export type InboundEmailProcessResult =
  'created' | 'uncertain_created' | 'ignored' | 'duplicate';

const safe = (value: string, max: number): string =>
  value
    .replaceAll(/\p{Cc}+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, max);

const personName = (
  name: string | null,
  email: string,
): { firstName: string; lastName?: string } => {
  const fallback = email.split('@')[0] ?? 'Inbound lead';
  const parts = safe(name ?? fallback, 200)
    .split(/\s+/u)
    .filter(Boolean);
  const firstName = parts.shift() ?? 'Inbound';
  const lastName = parts.join(' ');
  return { firstName, ...(lastName ? { lastName } : {}) };
};

const noteBody = (
  message: InboundEmailMessage,
  analysis: InboundEmailAnalysis,
): string =>
  [
    '## Inbound lead analysis',
    '',
    `- Classification: ${analysis.classification}`,
    `- Confidence: ${Math.round(analysis.confidence * 100)}%`,
    `- Method: ${analysis.analysisMethod}`,
    `- Source: ${analysis.source}`,
    `- Received: ${message.receivedAt.toISOString()}`,
    `- From: ${safe(message.from.address, 320)}`,
    `- Subject: ${safe(message.subject || '(no subject)', 500)}`,
    ...(analysis.companyName
      ? [`- Company: ${safe(analysis.companyName, 300)}`]
      : []),
    ...(analysis.intent ? [`- Intent: ${safe(analysis.intent, 500)}`] : []),
    ...(analysis.requestedServices.length
      ? [
          `- Requested services: ${analysis.requestedServices.map((item) => safe(item, 200)).join(', ')}`,
        ]
      : []),
    ...(analysis.riskSignals.length
      ? [
          `- Risk signals: ${analysis.riskSignals.map((item) => safe(item, 200)).join(', ')}`,
        ]
      : []),
    '',
    '### Summary',
    safe(analysis.summary, 1_000),
    '',
    '### Original message excerpt',
    safe(message.text || '(empty body)', 5_000),
    '',
    'This record was created from received mail. No reply or outreach was sent.',
  ].join('\n');

const isUniqueConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

const recordIgnored = async (
  message: InboundEmailMessage,
  analysis: InboundEmailAnalysis,
  store: InboundStore,
): Promise<'ignored' | 'duplicate'> => {
  try {
    await store.recordWebhook(
      message.eventId,
      'sales.inbound_email.ignored',
      {
        sender: message.from.address,
        subject: safe(message.subject, 500),
        receivedAt: message.receivedAt.toISOString(),
        classification: analysis.classification,
        confidence: analysis.confidence,
        analysisMethod: analysis.analysisMethod,
        riskSignals: analysis.riskSignals,
      },
      message.receivedAt,
    );
    return 'ignored';
  } catch (error) {
    if (isUniqueConflict(error)) return 'duplicate';
    throw error;
  }
};

export const processInboundEmail = async (input: {
  message: InboundEmailMessage;
  mailboxAddress: string;
  analyzer: InboundEmailAnalyzer;
  store: InboundStore;
  twenty: TwentyInboundClient;
  crmPublicUrl?: string;
  enqueue: (payload: CrmInboundLead) => Promise<void>;
}): Promise<InboundEmailProcessResult> => {
  if (await input.store.hasWebhook(input.message.eventId)) return 'duplicate';
  const analysis = await input.analyzer.analyze(
    input.message,
    input.mailboxAddress,
  );
  if (analysis.classification === 'NON_LEAD' || !analysis.contactEmail)
    return recordIgnored(input.message, analysis, input.store);

  const name = personName(analysis.contactName, analysis.contactEmail);
  // The mailbox pipeline owns Telegram delivery. Use source markers that remain
  // descriptive in Twenty without matching the Twenty app's person.created
  // contact-form aliases, which would emit the same lead a second time.
  const crmLeadSource =
    analysis.source === 'CONTACT_FORM'
      ? 'MAILBOX_CONTACT_FORM'
      : 'MAILBOX_EMAIL';
  const person = await input.twenty.upsertPerson({
    ...name,
    email: analysis.contactEmail,
    source: crmLeadSource,
    externalId: input.message.eventId,
    ...(analysis.jobTitle ? { jobTitle: analysis.jobTitle } : {}),
  });
  await input.twenty.recordInteraction({
    externalId: input.message.eventId,
    title: `Inbound: ${safe(input.message.subject || 'No subject', 180)}`,
    body: noteBody(input.message, analysis),
    personId: person.id,
  });
  const crmUrl = input.crmPublicUrl
    ? `${input.crmPublicUrl.replace(/\/$/u, '')}/objects/people/${encodeURIComponent(person.id)}`
    : undefined;
  const payload: CrmInboundLead = {
    eventId: input.message.eventId,
    occurredAt: input.message.receivedAt.toISOString(),
    source: analysis.source,
    record: {
      id: person.id,
      name: [name.firstName, name.lastName].filter(Boolean).join(' '),
      email: analysis.contactEmail,
      ...(analysis.phone ? { phone: safe(analysis.phone, 80) } : {}),
      ...(analysis.companyName
        ? { companyName: safe(analysis.companyName, 300) }
        : {}),
      ...(analysis.jobTitle ? { jobTitle: safe(analysis.jobTitle, 300) } : {}),
      subject: safe(input.message.subject || '(bez předmětu)', 500),
      summary: safe(analysis.summary, 1_000),
      ...(analysis.intent ? { intent: safe(analysis.intent, 500) } : {}),
      requestedServices: analysis.requestedServices.map((item) =>
        safe(item, 200),
      ),
      classification: analysis.classification,
      confidence: analysis.confidence,
      analysisMethod: analysis.analysisMethod,
      ...(crmUrl ? { crmUrl } : {}),
    },
  };
  const accepted = await acceptCrmInboundLead(
    payload,
    input.store,
    input.enqueue,
  );
  if (accepted === 'duplicate') return 'duplicate';
  return analysis.classification === 'UNCERTAIN'
    ? 'uncertain_created'
    : 'created';
};

export class InboundEmailAutomation {
  public constructor(
    private readonly configuration: InboundMailboxConfiguration,
    private readonly analyzer: InboundEmailAnalyzer,
    private readonly store: InboundStore,
    private readonly twenty: TwentyInboundClient,
    private readonly enqueue: (payload: CrmInboundLead) => Promise<void>,
    private readonly logger: WatcherLogger,
    private readonly crmPublicUrl?: string,
    private readonly reader = readInboundMailbox,
  ) {}

  public async poll(): Promise<{
    fetched: number;
    created: number;
    uncertainCreated: number;
    ignored: number;
    duplicates: number;
    failed: number;
  }> {
    const messages = await this.reader(this.configuration);
    const counts = {
      fetched: messages.length,
      created: 0,
      uncertainCreated: 0,
      ignored: 0,
      duplicates: 0,
      failed: 0,
    };
    for (const message of messages) {
      try {
        const result = await processInboundEmail({
          message,
          mailboxAddress: this.configuration.address,
          analyzer: this.analyzer,
          store: this.store,
          twenty: this.twenty,
          enqueue: this.enqueue,
          ...(this.crmPublicUrl ? { crmPublicUrl: this.crmPublicUrl } : {}),
        });
        if (result === 'created') counts.created += 1;
        else if (result === 'uncertain_created') counts.uncertainCreated += 1;
        else if (result === 'ignored') counts.ignored += 1;
        else counts.duplicates += 1;
      } catch (error) {
        counts.failed += 1;
        this.logger.warn(
          { err: error, eventId: message.eventId },
          'Inbound sales email processing failed',
        );
      }
    }
    this.logger.info(counts, 'Inbound sales mailbox poll completed');
    return counts;
  }
}
