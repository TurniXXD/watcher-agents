import type { StudyStore } from '@watcher/database';
import type { NotionClient, NotionObject } from '@watcher/notion';
import { z } from 'zod';
import {
  bookCategories,
  bookDraftSchema,
  type BookDraft,
  type OpenLibraryBookClient,
} from './book-metadata.js';

const richTextItemSchema = z.object({
  plain_text: z.string().optional(),
  text: z.object({ content: z.string() }).optional(),
});

const notionPropertySchema = z
  .object({
    type: z.string().optional(),
    title: z.array(richTextItemSchema).optional(),
    rich_text: z.array(richTextItemSchema).optional(),
    multi_select: z.array(z.object({ name: z.string() })).optional(),
    select: z.object({ name: z.string() }).nullable().optional(),
    checkbox: z.boolean().optional(),
    number: z.number().nullable().optional(),
  })
  .passthrough();

const notionPageSchema = z.object({
  id: z.string().min(1),
  url: z.url().optional(),
  properties: z.record(z.string(), notionPropertySchema),
});

export type BookRecord = BookDraft & { id: string; url?: string };

export type BookListFilter =
  | { type: 'all' }
  | { type: 'category'; value: string }
  | { type: 'author'; value: string }
  | { type: 'next' }
  | { type: 'favorites' };

const richText = (value: string): Array<Record<string, unknown>> =>
  value.match(/[\s\S]{1,2000}/gu)?.map((content) => ({ text: { content } })) ??
  [];

const plainText = (
  values: z.infer<typeof richTextItemSchema>[] | undefined,
): string =>
  values
    ?.map((value) => value.plain_text ?? value.text?.content ?? '')
    .join('') ?? '';

const property = (
  page: z.infer<typeof notionPageSchema>,
  name: string,
): z.infer<typeof notionPropertySchema> => page.properties[name] ?? {};

const parseBookPage = (value: NotionObject): BookDraft => {
  const page = notionPageSchema.parse(value);
  const pages = property(page, 'Stran').number;
  return bookDraftSchema.parse({
    title: plainText(property(page, 'Kniha').title),
    author: plainText(property(page, 'Autor').rich_text),
    categories: (property(page, 'Kategorie').multi_select ?? []).map(
      ({ name }) => name,
    ),
    genre: property(page, 'Žánr').select?.name ?? 'Naučná',
    pages: pages ?? null,
    complexity: property(page, 'Složitost').select?.name ?? 'Neurčeno',
    note: plainText(property(page, 'Poznámka').rich_text),
    sourceUrl: page.url ?? 'https://www.notion.so',
    priority: property(page, 'Priorita').checkbox ?? false,
    read: property(page, 'Přečteno').checkbox ?? false,
    nextToRead: property(page, 'Next to read').checkbox ?? false,
    favorite: property(page, 'Oblíbená').checkbox ?? false,
  });
};

const pageProperties = (draft: BookDraft): Record<string, unknown> => ({
  Kniha: { title: richText(draft.title) },
  Autor: { rich_text: richText(draft.author) },
  Kategorie: {
    multi_select: draft.categories.map((name) => ({ name })),
  },
  'Next to read': { checkbox: draft.nextToRead },
  Oblíbená: { checkbox: draft.favorite },
  Poznámka: { rich_text: richText(draft.note) },
  Priorita: { checkbox: draft.priority },
  Přečteno: { checkbox: draft.read },
  Složitost: { select: { name: draft.complexity } },
  Stran: { number: draft.pages },
  Žánr: { select: { name: draft.genre } },
});

const notionFilter = (
  filter: BookListFilter,
): Record<string, unknown> | undefined => {
  switch (filter.type) {
    case 'all':
      return undefined;
    case 'category':
      return {
        property: 'Kategorie',
        multi_select: { contains: filter.value },
      };
    case 'author':
      return { property: 'Autor', rich_text: { contains: filter.value } };
    case 'next':
      return { property: 'Next to read', checkbox: { equals: true } };
    case 'favorites':
      return { property: 'Oblíbená', checkbox: { equals: true } };
  }
};

export class StudyBookLibrary {
  public constructor(
    private readonly store: StudyStore,
    private readonly notion: NotionClient,
    private readonly dataSourceId: string,
    private readonly metadata: Pick<OpenLibraryBookClient, 'find'>,
  ) {}

  public async prepare(input: {
    chatId: bigint;
    userId: bigint;
    title: string;
  }) {
    const draft = await this.metadata.find(
      input.title,
      AbortSignal.timeout(15_000),
    );
    const row = await this.store.createBookDraft({
      chatId: input.chatId,
      userId: input.userId,
      title: draft.title,
      payload: draft,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    return { id: row.id, draft };
  }

  public async confirm(input: {
    id: string;
    chatId: bigint;
    userId: bigint;
  }): Promise<{ created: boolean; title: string; url?: string }> {
    const row = await this.store.getPendingBookDraft(input);
    if (!row)
      throw new Error('This book confirmation expired or was already used.');
    const draft = bookDraftSchema.parse(row.payload);
    if (!(await this.store.claimBookDraft(input))) {
      throw new Error('This book confirmation is already being processed.');
    }
    try {
      const existing = await this.notion.queryDataSource(
        this.dataSourceId,
        {
          filter: { property: 'Kniha', title: { equals: draft.title } },
          page_size: 2,
        },
        AbortSignal.timeout(30_000),
      );
      const found = existing.results[0];
      if (found) {
        const parsed = notionPageSchema.parse(found);
        await this.store.completeBookDraft(row.id, {
          notionPageId: parsed.id,
          ...(parsed.url ? { notionPageUrl: parsed.url } : {}),
        });
        return {
          created: false,
          title: draft.title,
          ...(parsed.url ? { url: parsed.url } : {}),
        };
      }
      const created = notionPageSchema.parse(
        await this.notion.createPage(
          {
            parent: {
              type: 'data_source_id',
              data_source_id: this.dataSourceId,
            },
            properties: pageProperties(draft),
          },
          AbortSignal.timeout(30_000),
        ),
      );
      await this.store.completeBookDraft(row.id, {
        notionPageId: created.id,
        ...(created.url ? { notionPageUrl: created.url } : {}),
      });
      return {
        created: true,
        title: draft.title,
        ...(created.url ? { url: created.url } : {}),
      };
    } catch (error) {
      await this.store.releaseBookDraft(row.id, error);
      throw error;
    }
  }

  public cancel(input: { id: string; chatId: bigint; userId: bigint }) {
    return this.store.cancelBookDraft(input);
  }

  public async list(filter: BookListFilter): Promise<BookRecord[]> {
    const rows: NotionObject[] = [];
    let cursor: string | undefined;
    do {
      const filterBody = notionFilter(filter);
      const page = await this.notion.queryDataSource(
        this.dataSourceId,
        {
          ...(filterBody ? { filter: filterBody } : {}),
          sorts: [{ property: 'Kniha', direction: 'ascending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
        AbortSignal.timeout(30_000),
      );
      rows.push(...page.results);
      cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
    } while (cursor && rows.length < 500);
    return rows.map((row) => {
      const parsed = notionPageSchema.parse(row);
      const draft = parseBookPage(row);
      return {
        ...draft,
        id: parsed.id,
        ...(parsed.url ? { url: parsed.url } : {}),
      };
    });
  }

  public categories(): Promise<string[]> {
    return Promise.resolve(
      [...bookCategories].sort((left, right) =>
        left.localeCompare(right, 'cs'),
      ),
    );
  }

  public async authors(): Promise<string[]> {
    const books = await this.list({ type: 'all' });
    return [...new Set(books.map(({ author }) => author).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right, 'cs'),
    );
  }
}
