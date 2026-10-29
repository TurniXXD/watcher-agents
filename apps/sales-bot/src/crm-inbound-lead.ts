import type { TelegramOutboxStore } from '@watcher/database';
import { z } from 'zod';

export const salesInboundLeadKind = 'SALES_INBOUND_CRM_LEAD';

export const crmInboundLeadSchema = z
  .object({
    eventId: z.string().trim().min(1).max(300),
    occurredAt: z.iso.datetime({ offset: true }),
    source: z.enum(['CONTACT_FORM', 'EMAIL']),
    record: z
      .object({
        id: z.string().trim().min(1).max(300),
        name: z.string().trim().min(1).max(300).optional(),
        email: z.email().optional(),
        phone: z.string().trim().min(1).max(80).optional(),
        companyName: z.string().trim().min(1).max(300).optional(),
        jobTitle: z.string().trim().min(1).max(300).optional(),
        subject: z.string().trim().min(1).max(500).optional(),
        summary: z.string().trim().min(1).max(1_000).optional(),
        intent: z.string().trim().min(1).max(500).optional(),
        requestedServices: z
          .array(z.string().trim().min(1).max(200))
          .max(10)
          .optional(),
        classification: z.enum(['LEAD', 'UNCERTAIN']).optional(),
        confidence: z.number().min(0).max(1).optional(),
        analysisMethod: z.enum(['AI', 'DETERMINISTIC']).optional(),
        crmUrl: z.url().optional(),
      })
      .strict(),
  })
  .strict();

export type CrmInboundLead = z.infer<typeof crmInboundLeadSchema>;

type WebhookStore = {
  hasWebhook: (id: string) => PromiseLike<{ id: string } | null>;
  recordWebhook: (
    id: string,
    event: string,
    payload: unknown,
    occurredAt: Date,
    leadId?: string,
  ) => PromiseLike<unknown>;
};
type OutboxStore = Pick<TelegramOutboxStore, 'enqueueMany'>;

const safeLine = (value: string, max = 300): string =>
  value
    .replaceAll(/\p{Cc}+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, max);

export const renderCrmInboundLead = (payload: CrmInboundLead): string => {
  const source =
    payload.source === 'CONTACT_FORM'
      ? 'kontaktní formulář'
      : 'příchozí e-mail';
  return [
    '🔔 Nový příchozí lead v CRM',
    `Zdroj: ${source}`,
    `Kontakt: ${safeLine(payload.record.name ?? 'neuveden')}`,
    ...(payload.record.email
      ? [`E-mail: ${safeLine(payload.record.email)}`]
      : []),
    ...(payload.record.phone
      ? [`Telefon: ${safeLine(payload.record.phone, 80)}`]
      : []),
    ...(payload.record.companyName
      ? [`Firma: ${safeLine(payload.record.companyName)}`]
      : []),
    ...(payload.record.jobTitle
      ? [`Pozice: ${safeLine(payload.record.jobTitle)}`]
      : []),
    ...(payload.record.subject
      ? [`Předmět: ${safeLine(payload.record.subject, 500)}`]
      : []),
    ...(payload.record.classification
      ? [
          `Klasifikace: ${payload.record.classification === 'LEAD' ? 'lead' : 'nejistý potenciální lead'}${payload.record.confidence === undefined ? '' : ` (${Math.round(payload.record.confidence * 100)} %, ${payload.record.analysisMethod === 'AI' ? 'AI' : 'pravidla'})`}`,
        ]
      : []),
    ...(payload.record.intent
      ? [`Záměr: ${safeLine(payload.record.intent, 500)}`]
      : []),
    ...(payload.record.requestedServices?.length
      ? [
          `Poptávané služby: ${payload.record.requestedServices.map((item) => safeLine(item, 200)).join(', ')}`,
        ]
      : []),
    ...(payload.record.summary
      ? [`Shrnutí: ${safeLine(payload.record.summary, 1_000)}`]
      : []),
    `CRM ID: ${safeLine(payload.record.id)}`,
    ...(payload.record.crmUrl ? [`CRM: ${payload.record.crmUrl}`] : []),
  ].join('\n');
};

export const enqueueCrmInboundLead = async (
  payload: CrmInboundLead,
  userIds: ReadonlySet<number>,
  outbox: OutboxStore,
): Promise<void> => {
  const body = renderCrmInboundLead(payload);
  await outbox.enqueueMany(
    [...userIds].map((userId) => ({
      kind: salesInboundLeadKind,
      deduplicationKey: `${payload.eventId}:${userId}`,
      chatId: BigInt(userId),
      body,
    })),
  );
};

export const acceptCrmInboundLead = async (
  payload: CrmInboundLead,
  store: WebhookStore,
  enqueue: (payload: CrmInboundLead) => Promise<void>,
): Promise<'accepted' | 'duplicate'> => {
  if (await store.hasWebhook(payload.eventId)) return 'duplicate';

  await enqueue(payload);
  try {
    await store.recordWebhook(
      payload.eventId,
      'crm.inbound_lead',
      payload,
      new Date(payload.occurredAt),
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    )
      return 'duplicate';
    throw error;
  }
  return 'accepted';
};
