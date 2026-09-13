import { afterEach, describe, expect, it, vi } from 'vitest';
import { BioRxivSource } from '../biorxiv.js';
import { PubMedSource } from '../pubmed.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('publication source request control', () => {
  it('spaces every PubMed E-utilities HTTP request', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/esearch.fcgi')) {
        return Response.json({ esearchresult: { idlist: ['123'] } });
      }
      return new Response(`
        <PubmedArticleSet>
          <PubmedArticle>
            <MedlineCitation>
              <PMID>123</PMID>
              <Article>
                <ArticleTitle>Test publication</ArticleTitle>
                <Abstract><AbstractText>Test abstract</AbstractText></Abstract>
              </Article>
            </MedlineCitation>
          </PubmedArticle>
        </PubmedArticleSet>
      `);
    });
    const source = new PubMedSource(fetcher);

    const resultPromise = source.fetch({ query: 'test query' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(resultPromise).resolves.toMatchObject([
      { externalId: '123', title: 'Test publication' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries a transient PubMed transport termination once', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ esearchresult: { idlist: ['123'] } }),
      )
      .mockRejectedValueOnce(new TypeError('terminated'))
      .mockResolvedValueOnce(
        new Response(`
        <PubmedArticleSet>
          <PubmedArticle>
            <MedlineCitation>
              <PMID>123</PMID>
              <Article>
                <ArticleTitle>Test publication</ArticleTitle>
                <Abstract><AbstractText>Test abstract</AbstractText></Abstract>
              </Article>
            </MedlineCitation>
          </PubmedArticle>
        </PubmedArticleSet>
      `),
      );
    const source = new PubMedSource(fetcher);

    const result = source.fetch({ query: 'test query' });
    const assertion = expect(result).resolves.toMatchObject([
      { externalId: '123', title: 'Test publication' },
    ]);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('retries and then reuses a failed bioRxiv request without hammering the provider', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    const source = new BioRxivSource(fetcher);

    const first = expect(source.fetch({ query: 'genomics' })).rejects.toThrow(
      'aborted due to timeout',
    );
    await vi.runAllTimersAsync();
    await first;
    await expect(source.fetch({ query: 'proteomics' })).rejects.toThrow(
      'aborted due to timeout',
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('downloads one bioRxiv dataset and filters it for multiple queries', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        collection: [
          {
            doi: '10.1101/one',
            title: 'CRISPR therapy study',
            abstract: 'Gene editing result',
            date: '2026-09-06',
            authors: 'A. Researcher',
            category: 'bioengineering',
          },
          {
            doi: '10.1101/two',
            title: 'Microbiome study',
            abstract: 'Gut bacteria result',
            date: '2026-09-06',
            authors: 'B. Researcher',
            category: 'microbiology',
          },
        ],
      }),
    );
    const source = new BioRxivSource(fetcher);

    await expect(source.fetch({ query: 'CRISPR' })).resolves.toMatchObject([
      { externalId: '10.1101/one' },
    ]);
    await expect(source.fetch({ query: 'microbiome' })).resolves.toMatchObject([
      { externalId: '10.1101/two' },
    ]);

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retries an empty bioRxiv JSON response once', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          collection: [
            {
              doi: '10.1101/retried',
              title: 'Aging intervention',
              abstract: 'Aging result',
              date: '2026-09-10',
              authors: 'A. Researcher',
              category: 'aging',
            },
          ],
        }),
      );
    const source = new BioRxivSource(fetcher);

    await expect(source.fetch({ query: 'aging' })).resolves.toMatchObject([
      { externalId: '10.1101/retried' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
