import { z } from 'zod';
import { NotionClient } from './notion-client.js';
import { dailyJournalDatabasePayload } from './notion-journal.js';

const setupEnv = z
  .object({
    NOTION_API_KEY: z.string().min(1),
    NOTION_PARENT_PAGE_ID: z.string().min(1),
    NOTION_API_VERSION: z.string().min(1).default('2026-03-11'),
  })
  .parse(process.env);

const client = new NotionClient({
  apiKey: setupEnv.NOTION_API_KEY,
  apiVersion: setupEnv.NOTION_API_VERSION,
});

const database = await client.createDatabase(
  dailyJournalDatabasePayload(setupEnv.NOTION_PARENT_PAGE_ID),
  AbortSignal.timeout(30_000),
);
const dataSources = Array.isArray(database.data_sources)
  ? database.data_sources
  : [];
const firstDataSource = dataSources.find(
  (value): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object',
);
const dataSourceId =
  firstDataSource && typeof firstDataSource.id === 'string'
    ? firstDataSource.id
    : undefined;
let chronologicalViewCreated = false;
if (typeof database.id === 'string' && dataSourceId) {
  try {
    await client.createView(
      {
        database_id: database.id,
        data_source_id: dataSourceId,
        name: 'Chronologicky',
        type: 'table',
        sorts: [{ property: 'Date', direction: 'descending' }],
      },
      AbortSignal.timeout(30_000),
    );
    chronologicalViewCreated = true;
  } catch {
    chronologicalViewCreated = false;
  }
}

process.stdout.write(
  [
    'Created 📓 Daily Journal.',
    typeof database.id === 'string' ? `Database ID: ${database.id}` : undefined,
    dataSourceId ? `NOTION_JOURNAL_DATA_SOURCE_ID=${dataSourceId}` : undefined,
    chronologicalViewCreated
      ? 'Created the Chronologicky view sorted by Date descending.'
      : 'Create a view sorted by Date descending manually.',
    'Finish the native template/default-view steps documented in README.md.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n') + '\n',
);
