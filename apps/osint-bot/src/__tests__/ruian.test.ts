import { describe, expect, it, vi } from 'vitest';
import { createRuianAddressCollector } from '../collectors/ruian.js';

describe('RÚIAN address collector', () => {
  it('normalizes an explicit public address without inferring an owner', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            stavStandardizace: 'UPLNA',
            standardizovaneAdresy: [
              {
                kodAdresnihoMista: 123,
                kodStavebnihoObjektu: 2267001,
                kodObce: 456,
                nazevObce: 'Brno',
                textovaAdresa: 'Česká 1, 60200 Brno',
                psc: 60200,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const docs = await createRuianAddressCollector(fetcher).collect(
      {
        type: 'ADDRESS',
        value: 'Česká 1, Brno',
        original: 'adresa: Česká 1, Brno',
        depth: 0,
      },
      new AbortController().signal,
    );
    expect(docs[0]?.data.addressPlaceCode).toBe(123);
    expect(docs[0]?.findings[0]?.predicate).toBe('STANDARDIZED_ADDRESS');
    expect(docs[0]?.links[0]?.type).toBe('ADDRESS_OF_BUILDING');
    expect(docs[0]?.discoveredSelectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ADDRESS_PLACE',
          value: 'AD.123',
          depth: 0,
        }),
        expect.objectContaining({
          type: 'BUILDING',
          value: 'SO.2267001',
          depth: 1,
        }),
      ]),
    );
  });
});
