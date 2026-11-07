import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres';
import { LEGACY_BACKFILL_TASK } from '../jobs/legacy-backfill';

/**
 * Data migration: imports the events, news, publications, and socials-bot
 * content Watcher bots stored before the CMS integration. The import itself
 * runs as a background job (`backfillLegacyBotContent`) so a large backlog
 * never blocks startup; records arrive as `ingested` drafts for review.
 */
export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  await payload.jobs.queue({
    task: LEGACY_BACKFILL_TASK,
    input: {},
    req,
  });
}

/** Drops the job if it has not run. Imported records may already carry editorial work and are never deleted. */
export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  await payload.delete({
    collection: 'payload-jobs',
    where: {
      and: [
        { taskSlug: { equals: LEGACY_BACKFILL_TASK } },
        { completedAt: { exists: false } },
      ],
    },
    req,
  });
}
