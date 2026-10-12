import { z } from 'zod';
import type { NotionClient, NotionObject } from './notion-client.js';

export const journalSectionHeadings = {
  experienced: '🌤️ Co jsem dnes zažil a udělal?',
  joy: '😊 Co mi dnes udělalo radost?',
  challenges: '🧩 Co se nepovedlo a proč?',
  learned: '📚 Co nového jsem se naučil?',
  changes: '🔄 Co bych příště udělal jinak?',
  priority: '🎯 Jaká je jedna priorita na zítřek?',
} as const;

export type JournalSection = keyof typeof journalSectionHeadings;
export type JournalSections = Record<JournalSection, string>;

export type JournalEntry = {
  pageId: string;
  pageUrl?: string;
  date: string;
  title: string;
  mood?: string;
  energy?: number;
  tags: readonly string[];
  sections: JournalSections;
};

export type NotionBlockNode = NotionObject & {
  id: string;
  type: string;
  has_children: boolean;
  children: readonly NotionBlockNode[];
};

const pageSchema = z
  .object({
    id: z.string().min(1),
    properties: z.record(z.string(), z.unknown()),
  })
  .catchall(z.unknown());

const blockSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    has_children: z.boolean().default(false),
  })
  .catchall(z.unknown());

type JournalRepositoryOptions = {
  client: Pick<
    NotionClient,
    'queryDataSource' | 'listBlockChildren' | 'createPage'
  > &
    Partial<Pick<NotionClient, 'updateBlock'>>;
  dataSourceId: string;
  timezone: string;
};

export class DuplicateJournalEntryError extends Error {
  public constructor(public readonly date: string) {
    super(`More than one journal entry exists for ${date}`);
    this.name = 'DuplicateJournalEntryError';
  }
}

export class JournalContentConflictError extends Error {
  public constructor(public readonly section: JournalSection) {
    super(`Notion journal section ${section} was edited outside Telegram`);
    this.name = 'JournalContentConflictError';
  }
}

const localDate = (instant: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const previousIsoDate = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Invalid local date: ${date}`);
  return new Date(Date.UTC(year, month - 1, day - 1))
    .toISOString()
    .slice(0, 10);
};

export const yesterdayDateInTimezone = (
  now: Date,
  timezone = 'Europe/Prague',
): string => previousIsoDate(localDate(now, timezone));

export const todayDateInTimezone = (
  now: Date,
  timezone = 'Europe/Prague',
): string => localDate(now, timezone);

const richText = (value: unknown): string => {
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (typeof record.plain_text === 'string') return [record.plain_text];
      const text = record.text;
      if (!text || typeof text !== 'object') return [];
      const content = (text as Record<string, unknown>).content;
      return typeof content === 'string' ? [content] : [];
    })
    .join('');
};

const blockValue = (block: NotionBlockNode): Record<string, unknown> => {
  const value = block[block.type];
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
};

export const notionBlockText = (block: NotionBlockNode): string => {
  const value = blockValue(block);
  if (typeof value.title === 'string') return value.title.trim();
  const text = richText(value.rich_text).trim();
  if (block.type === 'to_do' && text) {
    return `${value.checked === true ? '[x]' : '[ ]'} ${text}`;
  }
  return text;
};

type BlockLine = { type: string; text: string; depth: number };

const blockLines = (
  blocks: readonly NotionBlockNode[],
  depth = 0,
): BlockLine[] =>
  blocks.flatMap((block) => {
    const text = notionBlockText(block);
    return [
      ...(text ? [{ type: block.type, text, depth }] : []),
      ...blockLines(block.children, depth + 1),
    ];
  });

const linePrefix = (line: BlockLine): string => {
  const indent = '  '.repeat(line.depth);
  if (line.type === 'bulleted_list_item') return `${indent}- `;
  if (line.type === 'numbered_list_item') return `${indent}1. `;
  return indent;
};

export const notionBlocksToText = (
  blocks: readonly NotionBlockNode[],
): string =>
  blockLines(blocks)
    .map((line) => `${linePrefix(line)}${line.text}`)
    .join('\n')
    .trim();

const normalizedHeading = (value: string): string =>
  value
    .normalize('NFKD')
    .toLocaleLowerCase('cs-CZ')
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

const headingSections = new Map(
  Object.entries(journalSectionHeadings).map(([section, heading]) => [
    normalizedHeading(heading),
    section as JournalSection,
  ]),
);

const emptySections = (): JournalSections => ({
  experienced: '',
  joy: '',
  challenges: '',
  learned: '',
  changes: '',
  priority: '',
});

export const extractJournalSections = (
  blocks: readonly NotionBlockNode[],
): JournalSections => {
  const collected: Record<JournalSection, string[]> = {
    experienced: [],
    joy: [],
    challenges: [],
    learned: [],
    changes: [],
    priority: [],
  };
  let current: JournalSection | undefined;
  for (const line of blockLines(blocks)) {
    const section = line.type.startsWith('heading_')
      ? headingSections.get(normalizedHeading(line.text))
      : undefined;
    if (section) {
      current = section;
      continue;
    }
    if (current) collected[current].push(`${linePrefix(line)}${line.text}`);
  }
  return Object.fromEntries(
    Object.entries(collected).map(([section, lines]) => [
      section,
      lines.join('\n').trim(),
    ]),
  ) as JournalSections;
};

const property = (
  properties: Record<string, unknown>,
  name: string,
): Record<string, unknown> => {
  const value = properties[name];
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
};

const nestedRecord = (
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined => {
  const value = record[key];
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
};

const pageDate = (properties: Record<string, unknown>): string | undefined => {
  const start = nestedRecord(property(properties, 'Date'), 'date')?.start;
  return typeof start === 'string' ? start.slice(0, 10) : undefined;
};

const pageTitle = (properties: Record<string, unknown>): string =>
  richText(property(properties, 'Name').title).trim();

const pageSelect = (
  properties: Record<string, unknown>,
  name: string,
): string | undefined => {
  const selected = nestedRecord(property(properties, name), 'select')?.name;
  return typeof selected === 'string' ? selected : undefined;
};

const pageNumber = (
  properties: Record<string, unknown>,
  name: string,
): number | undefined => {
  const value = property(properties, name).number;
  return typeof value === 'number' ? value : undefined;
};

const pageTags = (properties: Record<string, unknown>): string[] => {
  const value = property(properties, 'Tags').multi_select;
  if (!Array.isArray(value)) return [];
  return value.flatMap((tag) => {
    if (!tag || typeof tag !== 'object') return [];
    const name = (tag as Record<string, unknown>).name;
    return typeof name === 'string' ? [name] : [];
  });
};

const richTextPayload = (content: string): Record<string, unknown>[] =>
  content.match(/[\s\S]{1,2000}/gu)?.map((part) => ({
    type: 'text',
    text: { content: part },
  })) ?? [];

const paragraph = (content = ''): Record<string, unknown> => ({
  object: 'block',
  type: 'paragraph',
  paragraph: {
    rich_text: richTextPayload(content),
  },
});

export const journalTemplateChildren = (): Record<string, unknown>[] =>
  Object.values(journalSectionHeadings).flatMap((heading) => [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: heading } }],
      },
    },
    paragraph(),
  ]);

export const journalChildren = (
  sections: JournalSections,
): Record<string, unknown>[] =>
  (
    Object.entries(journalSectionHeadings) as [JournalSection, string][]
  ).flatMap(([section, heading]) => [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: heading } }],
      },
    },
    paragraph(sections[section]),
  ]);

export class NotionJournalRepository {
  public constructor(private readonly options: JournalRepositoryOptions) {}

  public async loadYesterday(
    now = new Date(),
    signal?: AbortSignal,
  ): Promise<JournalEntry | undefined> {
    return this.findByDate(
      yesterdayDateInTimezone(now, this.options.timezone),
      signal,
    );
  }

  public async findByDate(
    date: string,
    signal?: AbortSignal,
  ): Promise<JournalEntry | undefined> {
    const pages = await this.queryPagesForDate(date, signal);
    if (pages.length === 0) return undefined;
    if (pages.length > 1) throw new DuplicateJournalEntryError(date);
    const page = pageSchema.parse(pages[0]);
    const explicitDate = pageDate(page.properties);
    if (explicitDate !== date) {
      throw new Error(`Journal page Date does not match ${date}`);
    }
    const blocks = await this.loadAllChildren(page.id, signal);
    const mood = pageSelect(page.properties, 'Mood');
    const energy = pageNumber(page.properties, 'Energy');
    return {
      pageId: page.id,
      ...(typeof page.url === 'string' ? { pageUrl: page.url } : {}),
      date: explicitDate,
      title: pageTitle(page.properties),
      ...(mood ? { mood } : {}),
      ...(energy === undefined ? {} : { energy }),
      tags: pageTags(page.properties),
      sections: extractJournalSections(blocks),
    };
  }

  public async saveConfirmed(
    date: string,
    sections: JournalSections,
    previouslySynced?: JournalSections,
    signal?: AbortSignal,
  ): Promise<JournalEntry> {
    const pages = await this.queryPagesForDate(date, signal);
    if (pages.length > 1) throw new DuplicateJournalEntryError(date);
    if (pages.length === 0) {
      const created = await this.options.client.createPage(
        {
          parent: {
            type: 'data_source_id',
            data_source_id: this.options.dataSourceId,
          },
          properties: {
            Name: {
              title: [{ type: 'text', text: { content: 'Denní reflexe' } }],
            },
            Date: { date: { start: date } },
          },
          children: journalChildren(sections),
        },
        signal,
      );
      const page = pageSchema.parse({
        ...created,
        properties: created.properties ?? {},
      });
      return {
        pageId: page.id,
        ...(typeof page.url === 'string' ? { pageUrl: page.url } : {}),
        date,
        title: 'Denní reflexe',
        tags: [],
        sections,
      };
    }

    const page = pageSchema.parse(pages[0]);
    const blocks = await this.loadAllChildren(page.id, signal);
    const current = extractJournalSections(blocks);
    const slots = new Map<JournalSection, NotionBlockNode>();
    let section: JournalSection | undefined;
    for (const block of blocks) {
      const matched = block.type.startsWith('heading_')
        ? headingSections.get(normalizedHeading(notionBlockText(block)))
        : undefined;
      if (matched) {
        section = matched;
        continue;
      }
      if (section && block.type === 'paragraph' && !slots.has(section)) {
        slots.set(section, block);
      }
    }
    for (const key of Object.keys(journalSectionHeadings) as JournalSection[]) {
      const safeExisting =
        current[key] === sections[key] ||
        current[key] === '' ||
        (previouslySynced !== undefined &&
          current[key] === previouslySynced[key]);
      if (!safeExisting) throw new JournalContentConflictError(key);
      if (current[key] === sections[key]) continue;
      const slot = slots.get(key);
      if (!slot) throw new JournalContentConflictError(key);
      if (!this.options.client.updateBlock) {
        throw new Error('Notion block updates are not configured');
      }
      await this.options.client.updateBlock(
        slot.id,
        { paragraph: { rich_text: richTextPayload(sections[key]) } },
        signal,
      );
    }
    return {
      pageId: page.id,
      ...(typeof page.url === 'string' ? { pageUrl: page.url } : {}),
      date,
      title: pageTitle(page.properties),
      tags: pageTags(page.properties),
      sections,
    };
  }

  public async ensureTodayEntry(
    now = new Date(),
    signal?: AbortSignal,
  ): Promise<{ entry: JournalEntry; created: boolean }> {
    const date = todayDateInTimezone(now, this.options.timezone);
    const existing = await this.findByDate(date, signal);
    if (existing) return { entry: existing, created: false };
    const created = await this.options.client.createPage(
      {
        parent: {
          type: 'data_source_id',
          data_source_id: this.options.dataSourceId,
        },
        properties: {
          Name: {
            title: [{ type: 'text', text: { content: 'Denní reflexe' } }],
          },
          Date: { date: { start: date } },
        },
        children: journalTemplateChildren(),
      },
      signal,
    );
    const page = pageSchema.parse({
      ...created,
      properties: created.properties ?? {},
    });
    return {
      created: true,
      entry: {
        pageId: page.id,
        ...(typeof page.url === 'string' ? { pageUrl: page.url } : {}),
        date,
        title: 'Denní reflexe',
        tags: [],
        sections: emptySections(),
      },
    };
  }

  private async queryPagesForDate(
    date: string,
    signal?: AbortSignal,
  ): Promise<NotionObject[]> {
    const pages: NotionObject[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.options.client.queryDataSource(
        this.options.dataSourceId,
        {
          filter: { property: 'Date', date: { equals: date } },
          sorts: [{ property: 'Created', direction: 'descending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
        signal,
      );
      pages.push(...response.results);
      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);
    return pages;
  }

  private async loadAllChildren(
    blockId: string,
    signal?: AbortSignal,
  ): Promise<NotionBlockNode[]> {
    const blocks: NotionObject[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.options.client.listBlockChildren(
        blockId,
        cursor,
        signal,
      );
      blocks.push(...response.results);
      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);
    return Promise.all(
      blocks.map(async (raw) => {
        const block = blockSchema.parse(raw);
        return {
          ...block,
          children: block.has_children
            ? await this.loadAllChildren(block.id, signal)
            : [],
        };
      }),
    );
  }
}

export const dailyJournalDatabasePayload = (
  parentPageId: string,
): Record<string, unknown> => ({
  parent: { type: 'page_id', page_id: parentPageId },
  title: [{ type: 'text', text: { content: '📓 Daily Journal' } }],
  icon: { type: 'emoji', emoji: '📓' },
  is_inline: false,
  initial_data_source: {
    properties: {
      Name: { title: {} },
      Date: { date: {} },
      Created: { created_time: {} },
      Mood: {
        select: {
          options: ['Great', 'Good', 'Neutral', 'Bad', 'Terrible'].map(
            (name) => ({ name }),
          ),
        },
      },
      Energy: { number: { format: 'number' } },
      Tags: { multi_select: { options: [] } },
    },
  },
});
