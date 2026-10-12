import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateJournalEntryError,
  JournalContentConflictError,
  NotionJournalRepository,
  extractJournalSections,
  journalSectionHeadings,
  notionBlocksToText,
  todayDateInTimezone,
  yesterdayDateInTimezone,
  type NotionBlockNode,
} from '../notion-journal.js';

const richText = (content: string) => [{ plain_text: content }];

const block = (
  id: string,
  type: string,
  text: string,
  children: NotionBlockNode[] = [],
): NotionBlockNode => ({
  id,
  object: 'block',
  type,
  has_children: children.length > 0,
  [type]: { rich_text: richText(text) },
  children,
});

const page = (id: string, date: string) => ({
  id,
  properties: {
    Name: { title: richText(`Deník – ${date}`) },
    Date: { date: { start: date } },
    Created: { created_time: '2026-03-29T19:00:00.000Z' },
    Mood: { select: { name: 'Good' } },
    Energy: { number: 8 },
    Tags: { multi_select: [{ name: 'práce' }] },
  },
});

const client = () => ({
  queryDataSource: vi.fn(),
  listBlockChildren: vi.fn(),
  createPage: vi.fn(),
  updateBlock: vi.fn(),
});

describe('Notion journal calendar dates', () => {
  it('calculates yesterday across a year boundary in Prague', () => {
    const now = new Date('2025-12-31T23:30:00.000Z');
    expect(todayDateInTimezone(now, 'Europe/Prague')).toBe('2026-01-01');
    expect(yesterdayDateInTimezone(now, 'Europe/Prague')).toBe('2025-12-31');
  });

  it('uses calendar days across Prague daylight-saving transitions', () => {
    expect(
      yesterdayDateInTimezone(
        new Date('2026-03-30T05:00:00.000Z'),
        'Europe/Prague',
      ),
    ).toBe('2026-03-29');
    expect(
      yesterdayDateInTimezone(
        new Date('2026-10-26T06:00:00.000Z'),
        'Europe/Prague',
      ),
    ).toBe('2026-10-25');
  });
});

describe('Notion journal block extraction', () => {
  it('extracts Czech reflection sections from nested blocks', () => {
    const blocks = [
      block('h1', 'heading_2', journalSectionHeadings.experienced),
      block('p1', 'paragraph', 'Dokončil jsem návrh.', [
        block('b1', 'bulleted_list_item', 'Odeslal jsem ho klientovi.'),
      ]),
      block('h2', 'heading_2', journalSectionHeadings.priority),
      block('p2', 'paragraph', 'Dokončit nabídku.'),
    ];

    const sections = extractJournalSections(blocks);

    expect(sections.experienced).toContain('Dokončil jsem návrh.');
    expect(sections.experienced).toContain('Odeslal jsem ho klientovi.');
    expect(sections.priority).toBe('Dokončit nabídku.');
    expect(sections.joy).toBe('');
    expect(notionBlocksToText(blocks)).toContain(
      '  - Odeslal jsem ho klientovi.',
    );
  });
});

describe('NotionJournalRepository', () => {
  it('finds the explicit-date entry and retrieves paginated nested blocks', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [page('page-1', '2026-03-29')],
      has_more: false,
      next_cursor: null,
    });
    api.listBlockChildren
      .mockResolvedValueOnce({
        results: [
          {
            id: 'h1',
            type: 'heading_2',
            has_children: false,
            heading_2: {
              rich_text: richText(journalSectionHeadings.experienced),
            },
          },
        ],
        has_more: true,
        next_cursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'toggle-1',
            type: 'toggle',
            has_children: true,
            toggle: { rich_text: richText('Práce') },
          },
        ],
        has_more: false,
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            type: 'paragraph',
            has_children: false,
            paragraph: { rich_text: richText('Dokončil jsem návrh.') },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    const entry = await repository.findByDate('2026-03-29');

    expect(entry).toMatchObject({
      pageId: 'page-1',
      date: '2026-03-29',
      mood: 'Good',
      energy: 8,
      tags: ['práce'],
    });
    expect(entry?.sections.experienced).toContain('Dokončil jsem návrh.');
    expect(api.listBlockChildren).toHaveBeenNthCalledWith(
      2,
      'page-1',
      'cursor-2',
      undefined,
    );
    expect(api.listBlockChildren).toHaveBeenNthCalledWith(
      3,
      'toggle-1',
      undefined,
      undefined,
    );
  });

  it('returns undefined when the date has no entry', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    await expect(repository.findByDate('2026-03-29')).resolves.toBeUndefined();
    expect(api.listBlockChildren).not.toHaveBeenCalled();
  });

  it('rejects duplicate entries for one calendar date', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [page('page-1', '2026-03-29'), page('page-2', '2026-03-29')],
      has_more: false,
      next_cursor: null,
    });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    await expect(repository.findByDate('2026-03-29')).rejects.toBeInstanceOf(
      DuplicateJournalEntryError,
    );
  });

  it('uses the Date property as authoritative and rejects a mismatch', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [page('page-1', '2026-03-28')],
      has_more: false,
      next_cursor: null,
    });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    await expect(repository.findByDate('2026-03-29')).rejects.toThrow(
      'Date does not match',
    );
  });

  it('reuses an existing entry instead of creating a duplicate today', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [page('page-1', '2026-03-29')],
      has_more: false,
      next_cursor: null,
    });
    api.listBlockChildren.mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    const result = await repository.ensureTodayEntry(
      new Date('2026-03-29T10:00:00.000Z'),
    );

    expect(result.created).toBe(false);
    expect(result.entry.pageId).toBe('page-1');
    expect(api.createPage).not.toHaveBeenCalled();
  });

  it('surfaces API errors to the degradable context loader', async () => {
    const api = client();
    api.queryDataSource.mockRejectedValue(new Error('Notion unavailable'));
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    await expect(repository.findByDate('2026-03-29')).rejects.toThrow(
      'Notion unavailable',
    );
  });

  it('creates one dated page with confirmed answers', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    api.createPage.mockResolvedValue({
      id: 'created-page',
      url: 'https://notion.so/created-page',
      properties: {},
    });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    const entry = await repository.saveConfirmed('2026-10-12', {
      experienced: 'Pracoval jsem.',
      joy: 'Procházka.',
      challenges: '',
      learned: '',
      changes: '',
      priority: 'Dokončit návrh.',
    });

    expect(entry.pageId).toBe('created-page');
    expect(api.createPage).toHaveBeenCalledTimes(1);
    expect(api.createPage.mock.calls[0]?.[0]).toMatchObject({
      properties: {
        Name: {
          title: [{ type: 'text', text: { content: 'Denní reflexe' } }],
        },
        Date: { date: { start: '2026-10-12' } },
      },
    });
  });

  it('does not overwrite a manually edited Notion section', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [page('page-1', '2026-10-12')],
      has_more: false,
      next_cursor: null,
    });
    api.listBlockChildren.mockResolvedValue({
      results: [
        block('heading', 'heading_2', journalSectionHeadings.experienced),
        block('paragraph', 'paragraph', 'Ruční úprava v Notion.'),
      ],
      has_more: false,
      next_cursor: null,
    });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    await expect(
      repository.saveConfirmed('2026-10-12', {
        experienced: 'Nový text z Telegramu.',
        joy: '',
        challenges: '',
        learned: '',
        changes: '',
        priority: '',
      }),
    ).rejects.toBeInstanceOf(JournalContentConflictError);
    expect(api.updateBlock).not.toHaveBeenCalled();
  });

  it('updates an empty existing page instead of creating a duplicate', async () => {
    const api = client();
    api.queryDataSource.mockResolvedValue({
      results: [page('page-1', '2026-10-12')],
      has_more: false,
      next_cursor: null,
    });
    api.listBlockChildren.mockResolvedValue({
      results: [
        block('heading', 'heading_2', journalSectionHeadings.experienced),
        block('paragraph', 'paragraph', ''),
      ],
      has_more: false,
      next_cursor: null,
    });
    api.updateBlock.mockResolvedValue({ id: 'paragraph' });
    const repository = new NotionJournalRepository({
      client: api,
      dataSourceId: 'journal-source',
      timezone: 'Europe/Prague',
    });

    await repository.saveConfirmed('2026-10-12', {
      experienced: 'Nový text z Telegramu.',
      joy: '',
      challenges: '',
      learned: '',
      changes: '',
      priority: '',
    });

    expect(api.createPage).not.toHaveBeenCalled();
    expect(api.updateBlock).toHaveBeenCalledWith(
      'paragraph',
      {
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: 'Nový text z Telegramu.' } },
          ],
        },
      },
      undefined,
    );
  });
});
