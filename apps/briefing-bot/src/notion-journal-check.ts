import { z } from 'zod';
import { NotionClient } from './notion-client.js';
import {
  NotionJournalRepository,
  yesterdayDateInTimezone,
} from './notion-journal.js';

const checkEnv = z
  .object({
    NOTION_API_KEY: z.string().min(1),
    NOTION_JOURNAL_DATA_SOURCE_ID: z.string().min(1),
    NOTION_API_VERSION: z.string().min(1).default('2026-03-11'),
    TIMEZONE: z.string().min(1).default('Europe/Prague'),
  })
  .parse(process.env);

const repository = new NotionJournalRepository({
  client: new NotionClient({
    apiKey: checkEnv.NOTION_API_KEY,
    apiVersion: checkEnv.NOTION_API_VERSION,
  }),
  dataSourceId: checkEnv.NOTION_JOURNAL_DATA_SOURCE_ID,
  timezone: checkEnv.TIMEZONE,
});
const now = new Date();
const date = yesterdayDateInTimezone(now, checkEnv.TIMEZONE);
const entry = await repository.loadYesterday(now, AbortSignal.timeout(30_000));

if (!entry) {
  process.stdout.write(`No journal entry found for ${date}.\n`);
} else {
  const populatedSections = Object.entries(entry.sections)
    .filter(([, content]) => content.trim().length > 0)
    .map(([name]) => name);
  process.stdout.write(
    [
      `Journal entry found for ${entry.date}.`,
      `Populated sections: ${populatedSections.join(', ') || 'none'}.`,
      'Private journal text was not printed.',
    ].join('\n') + '\n',
  );
}
