import { NotionClient } from '@watcher/notion';
import { z } from 'zod';

const setup = z
  .object({
    NOTION_API_KEY: z.string().min(1),
    NOTION_PARENT_PAGE_ID: z.string().min(1),
    NOTION_API_VERSION: z.string().default('2026-03-11'),
  })
  .parse(process.env);

const client = new NotionClient({
  apiKey: setup.NOTION_API_KEY,
  apiVersion: setup.NOTION_API_VERSION,
});

const select = (names: readonly string[]) => ({
  select: { options: names.map((name) => ({ name })) },
});

const database = await client.createDatabase(
  {
    parent: { type: 'page_id', page_id: setup.NOTION_PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: '📣 Content Calendar' } }],
    initial_data_source: {
      properties: {
        Name: { title: {} },
        'Local ID': { rich_text: {} },
        Channel: select(['LINKEDIN', 'INSTAGRAM', 'BLOG', 'NEWSLETTER']),
        Format: select([
          'TEXT_POST',
          'REEL',
          'CAROUSEL',
          'STORY',
          'BLOG_ARTICLE',
          'NEWSLETTER_ISSUE',
        ]),
        Status: select([
          'IDEA',
          'PLANNED',
          'PROMPT_READY',
          'DRAFT',
          'READY',
          'SCHEDULED',
          'PUBLISHED',
          'SKIPPED',
          'ARCHIVED',
        ]),
        'Planned Date': { date: {} },
        'Published Date': { date: {} },
        Projects: { multi_select: {} },
        Topics: { multi_select: {} },
        Pillar: { select: {} },
        Objective: { select: {} },
        Prompt: { rich_text: {} },
        Draft: { rich_text: {} },
        'Final Content': { rich_text: {} },
        'Published URL': { url: {} },
        'Source Links': { rich_text: {} },
      },
    },
  },
  AbortSignal.timeout(30_000),
);

const dataSources = Array.isArray(database.data_sources)
  ? database.data_sources
  : [];
const dataSource = dataSources.find(
  (value): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object',
);
const id = dataSource && typeof dataSource.id === 'string' ? dataSource.id : '';
process.stdout.write(
  `Vytvořena databáze 📣 Content Calendar.\nNOTION_SOCIALS_DATA_SOURCE_ID=${id}\n`,
);
