import { describe, expect, it, vi } from 'vitest';
import { StudyBookLibrary } from '../book-library.js';

const draft = {
  title: 'Dune',
  author: 'Frank Herbert',
  categories: ['Politika', 'Sci-fi'] as const,
  genre: 'Beletrie' as const,
  pages: 544,
  complexity: 'Střední' as const,
  note: 'Metadata: Open Library.',
  sourceUrl: 'https://openlibrary.org/works/OL893415W',
  priority: false,
  read: false,
  nextToRead: false,
  favorite: false,
};

const notionPage = (overrides: Record<string, unknown> = {}) => ({
  id: 'notion-page-id',
  url: 'https://www.notion.so/notion-page-id',
  properties: {
    Kniha: { title: [{ plain_text: 'Dune' }] },
    Autor: { rich_text: [{ plain_text: 'Frank Herbert' }] },
    Kategorie: {
      multi_select: [{ name: 'Politika' }, { name: 'Sci-fi' }],
    },
    Žánr: { select: { name: 'Beletrie' } },
    Stran: { number: 544 },
    Složitost: { select: { name: 'Střední' } },
    Poznámka: { rich_text: [{ plain_text: 'Stored note' }] },
    Priorita: { checkbox: true },
    Přečteno: { checkbox: false },
    'Next to read': { checkbox: true },
    Oblíbená: { checkbox: true },
  },
  ...overrides,
});

const createHarness = () => {
  const store = {
    createBookDraft: vi.fn().mockResolvedValue({ id: 'draft-id' }),
    getPendingBookDraft: vi.fn().mockResolvedValue({
      id: 'draft-id',
      payload: draft,
    }),
    claimBookDraft: vi.fn().mockResolvedValue(true),
    completeBookDraft: vi.fn().mockResolvedValue(undefined),
    releaseBookDraft: vi.fn().mockResolvedValue(undefined),
    cancelBookDraft: vi.fn().mockResolvedValue(true),
  };
  const notion = {
    queryDataSource: vi.fn(),
    createPage: vi.fn(),
  };
  const metadata = { find: vi.fn().mockResolvedValue(draft) };
  const library = new StudyBookLibrary(
    store as never,
    notion as never,
    'books-data-source',
    metadata,
  );
  return { library, metadata, notion, store };
};

describe('StudyBookLibrary', () => {
  it('persists an expiring owner-bound confirmation draft', async () => {
    const { library, metadata, store } = createHarness();

    const prepared = await library.prepare({
      chatId: 123n,
      userId: 456n,
      title: 'Dune',
    });

    expect(prepared).toEqual({ id: 'draft-id', draft });
    expect(metadata.find).toHaveBeenCalledWith('Dune', expect.any(AbortSignal));
    expect(store.createBookDraft).toHaveBeenCalledOnce();
    const createDraftInput = store.createBookDraft.mock.calls[0]?.[0] as {
      chatId: bigint;
      userId: bigint;
      title: string;
      payload: unknown;
      expiresAt: Date;
    };
    expect(createDraftInput).toMatchObject({
      chatId: 123n,
      userId: 456n,
      title: 'Dune',
      payload: draft,
    });
    expect(createDraftInput.expiresAt).toBeInstanceOf(Date);
  });

  it('creates a Notion row only after an atomic confirmation claim', async () => {
    const { library, notion, store } = createHarness();
    notion.queryDataSource.mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    notion.createPage.mockResolvedValue(notionPage());

    const result = await library.confirm({
      id: 'draft-id',
      chatId: 123n,
      userId: 456n,
    });

    expect(store.getPendingBookDraft).toHaveBeenCalledWith({
      id: 'draft-id',
      chatId: 123n,
      userId: 456n,
    });
    expect(store.claimBookDraft).toHaveBeenCalledOnce();
    expect(notion.createPage).toHaveBeenCalledOnce();
    const createPageCall = notion.createPage.mock.calls[0] as unknown as [
      {
        parent: Record<string, string>;
        properties: Record<string, unknown>;
      },
      AbortSignal,
    ];
    expect(createPageCall[0].parent).toEqual({
      type: 'data_source_id',
      data_source_id: 'books-data-source',
    });
    expect(createPageCall[0].properties).toMatchObject({
      Priorita: { checkbox: false },
      Přečteno: { checkbox: false },
      'Next to read': { checkbox: false },
      Oblíbená: { checkbox: false },
    });
    expect(createPageCall[0].properties).toHaveProperty('Kniha');
    expect(createPageCall[1]).toBeInstanceOf(AbortSignal);
    expect(store.completeBookDraft).toHaveBeenCalledOnce();
    expect(result).toEqual({
      created: true,
      title: 'Dune',
      url: 'https://www.notion.so/notion-page-id',
    });
  });

  it('does not create a duplicate exact-title row', async () => {
    const { library, notion } = createHarness();
    notion.queryDataSource.mockResolvedValue({
      results: [notionPage()],
      has_more: false,
      next_cursor: null,
    });

    const result = await library.confirm({
      id: 'draft-id',
      chatId: 123n,
      userId: 456n,
    });

    expect(notion.createPage).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('releases a claimed draft after a Notion failure so it can be retried', async () => {
    const { library, notion, store } = createHarness();
    notion.queryDataSource.mockRejectedValue(new Error('Notion unavailable'));

    await expect(
      library.confirm({ id: 'draft-id', chatId: 123n, userId: 456n }),
    ).rejects.toThrow('Notion unavailable');
    expect(store.releaseBookDraft).toHaveBeenCalledWith(
      'draft-id',
      expect.any(Error),
    );
  });

  it('uses Notion filters and reads current boolean fields', async () => {
    const { library, notion } = createHarness();
    notion.queryDataSource.mockResolvedValue({
      results: [notionPage()],
      has_more: false,
      next_cursor: null,
    });

    const books = await library.list({ type: 'next' });

    expect(notion.queryDataSource).toHaveBeenCalledWith(
      'books-data-source',
      expect.objectContaining({
        filter: {
          property: 'Next to read',
          checkbox: { equals: true },
        },
      }),
      expect.any(AbortSignal),
    );
    expect(books[0]).toMatchObject({
      title: 'Dune',
      complexity: 'Střední',
      priority: true,
      nextToRead: true,
      favorite: true,
    });
  });

  it('lists every supported category option from the Notion schema contract', async () => {
    const { library, notion } = createHarness();

    const categories = await library.categories();

    expect(categories).toContain('Biologie');
    expect(categories).toContain('Machine Learning');
    expect(categories).toContain('Sci-fi');
    expect(categories).toHaveLength(17);
    expect(notion.queryDataSource).not.toHaveBeenCalled();
  });
});
