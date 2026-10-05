import { describe, expect, it, vi } from 'vitest';
import { searchAresBusinesses } from '../ares.js';

const requestJson = (options: RequestInit | undefined): unknown => {
  if (typeof options?.body !== 'string')
    throw new Error('Expected a JSON request body');
  return JSON.parse(options.body) as unknown;
};

describe('ARES business discovery', () => {
  it('searches active subjects by CZ-NACE and registered locality', async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      if (String(input).includes('standardizovane-adresy')) {
        return new Response(
          JSON.stringify({
            standardizovaneAdresy: [{ kodObce: 582786, nazevObce: 'Brno' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          pocetCelkem: 2,
          ekonomickeSubjekty: [
            {
              ico: '12345678',
              obchodniJmeno: 'Aktivní autoservis s.r.o.',
              sidlo: { textovaAdresa: 'Brno' },
              czNace: ['95310'],
            },
            {
              ico: '87654321',
              obchodniJmeno: 'Zaniklý autoservis s.r.o.',
              datumZaniku: '2025-01-01',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await searchAresBusinesses(
      {
        query: 'autoservis',
        locality: 'Brno',
        limit: 20,
        naceCode: '95310',
      },
      { fetcher },
    );

    expect(result.subjects).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, options] = vi.mocked(fetcher).mock.calls[1]!;
    expect(requestJson(options)).toEqual({
      czNace: ['95310'],
      obchodniJmeno: 'autoservis',
      sidlo: { kodObce: 582786 },
      start: 0,
      pocet: 20,
      razeni: ['obchodniJmeno'],
    });
  });

  it('uses a business-name filter when no CZ-NACE code is resolved', async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const body = String(input).includes('standardizovane-adresy')
        ? {
            standardizovaneAdresy: [{ kodObce: 554782, nazevObce: 'Praha' }],
          }
        : { ekonomickeSubjekty: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await searchAresBusinesses(
      { query: 'Příklad', locality: 'Praha', limit: 5 },
      { fetcher },
    );

    const [, options] = vi.mocked(fetcher).mock.calls[1]!;
    expect(requestJson(options)).toMatchObject({
      obchodniJmeno: 'Příklad',
      sidlo: { kodObce: 554782 },
    });
  });

  it('omits a literal business-name filter for an explicit NACE query', async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const body = String(input).includes('standardizovane-adresy')
        ? {
            standardizovaneAdresy: [{ kodObce: 582786, nazevObce: 'Brno' }],
          }
        : { ekonomickeSubjekty: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await searchAresBusinesses(
      {
        query: 'nace:95310',
        locality: 'Brno',
        limit: 5,
        naceCode: '95310',
      },
      { fetcher },
    );

    const [, options] = vi.mocked(fetcher).mock.calls[1]!;
    expect(requestJson(options)).toEqual({
      czNace: ['95310'],
      sidlo: { kodObce: 582786 },
      start: 0,
      pocet: 5,
      razeni: ['obchodniJmeno'],
    });
  });
});
