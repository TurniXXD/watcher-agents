import type { TwentyRestClient } from './client.js';
import { filterEquals } from './deduplication.js';
import type {
  TwentyDraftInput,
  TwentyInteractionInput,
  TwentyRecord,
} from './types.js';

const upsertNote = async (
  client: TwentyRestClient,
  input: TwentyInteractionInput,
): Promise<TwentyRecord> => {
  if (!input.companyId && !input.personId) {
    throw new Error('Note requires a Company or Person target');
  }
  const existing = await client.find(
    'notes',
    filterEquals('title', input.title),
  );
  const bodyV2 = { markdown: input.body, blocknote: '' };
  if (existing) {
    return client.update('notes', 'note', existing.id, {
      title: input.title,
      bodyV2,
    });
  }
  const note = await client.create('notes', 'note', {
    title: input.title,
    bodyV2,
  });
  await client.create('noteTargets', 'noteTarget', {
    noteId: note.id,
    ...(input.companyId ? { targetCompanyId: input.companyId } : {}),
    ...(input.personId ? { targetPersonId: input.personId } : {}),
  });
  return note;
};

const draftTitle = (externalId: string): string =>
  `[sales-draft:${externalId}] Cold email draft`;

export const saveDraftNote = async (
  client: TwentyRestClient,
  input: TwentyDraftInput,
): Promise<TwentyRecord> => {
  const title = draftTitle(input.externalId);
  const markdown = `## ${input.subject}\n\n${input.body}\n\n---\nPrompt: ${input.promptVersion}  \nModel: ${input.model}  \nLanguage: ${input.language}  \nCountry: ${input.countryCode ?? 'unknown'}  \nLanguage confidence: ${input.languageDetectionConfidence ?? 'unknown'}  \nGeneration confidence: ${input.generationConfidence}  \nPersonalization fact: ${input.personalizationFact ?? 'insufficient data'}  \nGenerated: ${input.createdAt.toISOString()}\n\nDraft only — approval and legal basis must be verified before sending.`;
  return upsertNote(client, {
    externalId: input.externalId,
    title,
    body: markdown,
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.personId ? { personId: input.personId } : {}),
  });
};

export const recordInteraction = async (
  client: TwentyRestClient,
  input: TwentyInteractionInput,
): Promise<TwentyRecord> =>
  upsertNote(client, {
    ...input,
    title: `[sales-interaction:${input.externalId}] ${input.title}`,
  });

export const createFollowUpTask = async (
  client: TwentyRestClient,
  input: { companyId: string; title: string; body: string; dueAt?: Date },
): Promise<TwentyRecord> => {
  const existing = await client.find(
    'tasks',
    filterEquals('title', input.title),
  );
  if (existing) return existing;
  const task = await client.create('tasks', 'task', {
    title: input.title,
    bodyV2: { markdown: input.body, blocknote: '' },
    ...(input.dueAt ? { dueAt: input.dueAt.toISOString() } : {}),
  });
  await client.create('taskTargets', 'taskTarget', {
    taskId: task.id,
    targetCompanyId: input.companyId,
  });
  return task;
};
