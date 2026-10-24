import { defineLogicFunction } from 'twenty-sdk/define';
import type {
  DatabaseEventPayload,
  LogicFunctionExecutionContext,
  ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import {
  buildInboundLeadPayload,
  classifyInboundLead,
  type TwentyPersonRecord,
} from '../inbound-lead.js';

declare const process: { env: Record<string, string | undefined> };

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<TwentyPersonRecord>>,
  context: LogicFunctionExecutionContext,
) => {
  const person = event.properties.after;
  const source = classifyInboundLead(person, {
    workspaceMemberId: event.workspaceMemberId ?? context.workspaceMemberId,
    userWorkspaceId: event.userWorkspaceId ?? context.userWorkspaceId,
  });
  if (!source) return { ignored: true };

  const webhookUrl = process.env.SALES_INBOUND_WEBHOOK_URL;
  const webhookToken = process.env.SALES_INBOUND_WEBHOOK_TOKEN;
  if (!webhookUrl || !webhookToken)
    throw new Error('Sales inbound webhook application variables are missing');

  const url = new URL(webhookUrl);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Sales inbound webhook URL must use HTTP or HTTPS');

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
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webhookToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const responseText = (await response.text()).replaceAll(/\s+/gu, ' ');
    throw new Error(
      `Sales inbound webhook failed with HTTP ${response.status}: ${responseText.slice(0, 300)}`,
    );
  }
  return { notified: true };
};

export default defineLogicFunction({
  universalIdentifier: '7737c559-d86d-4de6-8fd3-7b1591f66b55',
  name: 'Notify Sales Bot about inbound people',
  description:
    'Notifies the private Sales Bot only for people created from incoming email or an explicitly tagged contact form.',
  timeoutSeconds: 15,
  databaseEventTriggerSettings: { eventName: 'person.created' },
  handler,
});
