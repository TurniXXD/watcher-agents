import { describe, expect, it, vi } from 'vitest';
import { OpenLibraryBookClient } from '../book-metadata.js';

describe('OpenLibraryBookClient', () => {
  it('validates and normalizes structured metadata for an exact title match', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              key: '/works/OL893415W',
              title: 'Dune',
              author_name: ['Frank Herbert'],
              subject: ['Science fiction', 'Politics'],
              number_of_pages_median: 544,
              first_publish_year: 1965,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const book = await new OpenLibraryBookClient(fetcher).find('Dune');

    expect(book).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      categories: ['Politika', 'Sci-fi'],
      genre: 'Beletrie',
      pages: 544,
      priority: false,
      read: false,
      nextToRead: false,
      favorite: false,
    });
    expect(book.sourceUrl).toBe('https://openlibrary.org/works/OL893415W');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports missing and malformed provider results instead of inventing data', async () => {
    const empty = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ docs: [] })));
    await expect(
      new OpenLibraryBookClient(empty).find('Unknown'),
    ).rejects.toThrow('No book metadata found');

    const malformed = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ docs: [{ title: 42 }] })),
      );
    await expect(
      new OpenLibraryBookClient(malformed).find('Broken'),
    ).rejects.toThrow();
  });

  it('reports bounded provider HTTP failures', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      new OpenLibraryBookClient(fetcher).find('Dune'),
    ).rejects.toThrow('HTTP 503');
  });
});
