import { describe, expect, it, vi } from 'vitest';
import {
  createContractRegistryCollector,
  parseContractSearch,
} from '../collectors/contracts.js';

describe('Czech Contract Registry parser', () => {
  it('extracts bounded public metadata from a result row', () => {
    const rows = parseContractSearch(`
      <table class="searchResultList"><tbody class="list"><tr>
        <td class="1">Publisher &amp; Partner</td>
        <td class="2">Service agreement</td>
        <td class="3">ano</td>
        <td class="4">01.10.2026</td>
        <td class="5">50 000 CZK bez DPH</td>
        <td class="6">Example s.r.o.</td>
        <td><a href="/smlouva/39740517?backlink=test">Detail</a></td>
      </tr></tbody></table>
    `);
    expect(rows).toEqual([
      {
        id: '39740517',
        url: 'https://smlouvy.gov.cz/smlouva/39740517?backlink=test',
        publisher: 'Publisher & Partner',
        subject: 'Service agreement',
        latestVersion: 'ano',
        publishedAt: '01.10.2026',
        value: '50 000 CZK bez DPH',
        parties: 'Example s.r.o.',
      },
    ]);
  });

  it('returns no invented record when the result table is absent', () => {
    expect(parseContractSearch('<p>Počet nalezených záznamů 0</p>')).toEqual(
      [],
    );
  });

  it('keeps a successful result when the independent companion search fails', async () => {
    const html = `<tbody class="list"><tr>
      <td>Publisher</td><td>Agreement</td><td>ano</td><td>01.10.2026</td>
      <td>100 CZK</td><td>Example s.r.o.</td>
      <td><a href="/smlouva/42">Detail</a></td>
    </tr></tbody>`;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      )
      .mockRejectedValueOnce(
        new Error('independent search unavailable'),
      ) as unknown as typeof fetch;

    const documents = await createContractRegistryCollector(
      fetcher,
      async (value) => new URL(value),
    ).collect(
      {
        type: 'ICO',
        value: '25301632',
        original: '25301632',
        depth: 0,
      },
      new AbortController().signal,
    );

    expect(documents).toHaveLength(1);
    expect(documents[0]?.sourceKey).toBe('registr-smluv:42');
  });
});
