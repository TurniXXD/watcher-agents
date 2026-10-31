import { defineLogicFunction } from 'twenty-sdk/define';
import type {
  DatabaseEventPayload,
  ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import {
  buildInboundNotePayload,
  isWatcherManagedNote,
  type TwentyNoteRecord,
} from '../inbound-lead.js';
import { postInboundWebhook } from '../inbound-webhook.js';

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<TwentyNoteRecord>>,
) => {
  const note = event.properties.after;
  if (isWatcherManagedNote(note)) return { ignored: true };

  const occurredAt = note.createdAt
    ? new Date(note.createdAt).toISOString()
    : new Date().toISOString();
  return postInboundWebhook(
    buildInboundNotePayload({
      eventId: `twenty:note.created:${event.workspaceId}:${event.recordId}`,
      occurredAt,
      recordId: event.recordId,
      note,
    }),
  );
};

export default defineLogicFunction({
  universalIdentifier: 'eeab0ad6-7be1-4a73-a6b9-cfc65d8cb24b',
  name: 'Notify Sales Bot about new CRM notes',
  description:
    'Notifies the private Sales Bot for each new CRM Note except Watcher-managed system notes that already own their alert.',
  timeoutSeconds: 15,
  databaseEventTriggerSettings: { eventName: 'note.created' },
  handler,
});
