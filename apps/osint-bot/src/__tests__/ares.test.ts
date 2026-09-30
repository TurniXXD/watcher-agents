import { describe, expect, it, vi } from 'vitest';
import {
  createAresCollector,
  createAresRegisterCollector,
} from '../collectors/ares.js';
import type { Selector } from '../selectors.js';

const selector: Selector = {
  type: 'ICO',
  value: '25301632',
  original: 'IČO 25301632',
  depth: 0,
};
const response = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('ARES collectors', () => {
  it('stores normalized official company facts and address provenance', async () => {
    const fetcher = vi.fn(async () =>
      response({
        ico: '25301632',
        obchodniJmeno: 'Příklad a.s.',
        pravniForma: '121',
        datumVzniku: '1996-06-05',
        sidlo: { textovaAdresa: 'Hlavní 1, Praha' },
        unrelatedPrivateField: 'do not keep',
      }),
    ) as unknown as typeof fetch;
    const docs = await createAresCollector(fetcher).collect(
      selector,
      new AbortController().signal,
    );
    expect(docs[0]?.data).toEqual({
      ico: '25301632',
      name: 'Příklad a.s.',
      legalForm: '121',
      registeredAt: '1996-06-05',
      address: 'Hlavní 1, Praha',
    });
    expect(docs[0]?.links[0]?.type).toBe('REGISTERED_AT_ADDRESS');
    expect(JSON.stringify(docs)).not.toContain('do not keep');
  });
  it('rejects a mismatching IČO and oversized official response', async () => {
    const mismatch = vi.fn(async () =>
      response({ ico: '12345679' }),
    ) as unknown as typeof fetch;
    await expect(
      createAresCollector(mismatch).collect(
        selector,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/different IČO/);
    const large = vi.fn(
      async () =>
        new Response('{}', { headers: { 'content-length': '2000001' } }),
    ) as unknown as typeof fetch;
    await expect(
      createAresCollector(large).collect(
        selector,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/size limit/);
  });
  it('does not retain an address for an unclassified or natural-person business', async () => {
    const fetcher = vi.fn(async () =>
      response({
        ico: '25301632',
        obchodniJmeno: 'Osoba podnikající',
        pravniForma: '101',
        sidlo: { textovaAdresa: 'Private Home' },
      }),
    ) as unknown as typeof fetch;
    const docs = await createAresCollector(fetcher).collect(
      selector,
      new AbortController().signal,
    );
    expect(JSON.stringify(docs)).not.toContain('Private Home');
    expect(docs[0]?.links).toHaveLength(0);
  });
  it('retains professional role but drops address and birth date', async () => {
    const fetcher = vi.fn(async () =>
      response({
        zaznamy: [
          {
            statutarniOrgany: [
              {
                clenoveOrganu: [
                  {
                    datumZapisu: '2020-01-01',
                    nazevAngazma: 'Jednatel',
                    fyzickaOsoba: {
                      jmeno: 'Jana',
                      prijmeni: 'Nová',
                      datumNarozeni: '1970-01-01',
                      adresa: { textovaAdresa: 'Private Street' },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const docs = await createAresRegisterCollector(fetcher).collect(
      selector,
      new AbortController().signal,
    );
    expect(
      docs.some((doc) =>
        doc.links.some((link) => link.type === 'STATUTORY_ROLE'),
      ),
    ).toBe(true);
    expect(JSON.stringify(docs)).toContain('Jana Nová');
    expect(JSON.stringify(docs)).not.toContain('Private Street');
    expect(JSON.stringify(docs)).not.toContain('1970-01-01');
  });
  it('does not label a removed register body as current', async () => {
    const fetcher = vi.fn(async () =>
      response({
        zaznamy: [
          {
            statutarniOrgany: [
              {
                datumVymazu: '2020-01-01',
                clenoveOrganu: [
                  { fyzickaOsoba: { jmeno: 'Former', prijmeni: 'Director' } },
                ],
              },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const docs = await createAresRegisterCollector(fetcher).collect(
      selector,
      new AbortController().signal,
    );
    expect(JSON.stringify(docs)).not.toContain('Former Director');
    expect(docs[0]?.data.activeRoster).toBe('');
  });
});
