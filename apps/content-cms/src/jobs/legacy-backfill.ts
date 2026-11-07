import type { TaskConfig } from 'payload';
import { backfillLegacyBotContent } from '../ingestion/legacy-backfill';

export const LEGACY_BACKFILL_TASK = 'backfillLegacyBotContent';

type Execute = (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Background import of content Watcher bots stored before the CMS existed.
 * Queued once by a migration and run by the jobs autoRun, so a large backlog
 * never delays startup or the healthcheck. Retries resume where the previous
 * attempt stopped because already imported identities are skipped.
 */
export const legacyBackfillTask: TaskConfig<'backfillLegacyBotContent'> = {
  slug: LEGACY_BACKFILL_TASK,
  label: 'Import legacy bot content',
  retries: 3,
  outputSchema: [{ name: 'summary', type: 'json', required: true }],
  handler: async ({ req }) => {
    const db = (req.payload.db as unknown as { drizzle: { execute: Execute } })
      .drizzle;
    const counts = await backfillLegacyBotContent(
      req.payload,
      async (query) => (await db.execute(query)).rows,
    );
    return { output: { summary: counts } };
  },
};
