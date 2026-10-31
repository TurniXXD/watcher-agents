import { defineLogicFunction } from 'twenty-sdk/define';
import type {
  DatabaseEventPayload,
  ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import {
  buildInboundLeadPayload,
  classifyInboundLead,
  type TwentyPersonRecord,
} from '../inbound-lead.js';
import { postInboundWebhook } from '../inbound-webhook.js';

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<TwentyPersonRecord>>,
) => {
  const person = event.properties.after;
  const source = classifyInboundLead(person);
  if (!source) return { ignored: true };

  const occurredAt = person.createdAt
    ? new Date(person.createdAt).toISOString()
    : new Date().toISOString();
  const payload = buildInboundLeadPayload({
    eventId: `twenty:person.created:${event.workspaceId}:${event.recordId}`,
    occurredAt,
    source,
    recordId: event.recordId,
    person,
  });
  return postInboundWebhook(payload);
};

export default defineLogicFunction({
  universalIdentifier: '7737c559-d86d-4de6-8fd3-7b1591f66b55',
  name: 'Notify Sales Bot about inbound people',
  description:
    'Notifies the private Sales Bot for every new CRM Person except records whose Watcher-owned pipeline already sends the alert.',
  timeoutSeconds: 15,
  databaseEventTriggerSettings: { eventName: 'person.created' },
  handler,
});
