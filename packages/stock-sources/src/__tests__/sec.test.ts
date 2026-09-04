import { describe, expect, it, vi } from 'vitest';
import { SecEdgarSource } from '../sec.js';

describe('SecEdgarSource', () => {
  it('resolves ticker metadata from the SEC ticker directory', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            '0': {
              cik_str: 723125,
              ticker: 'MU',
              title: 'Micron Technology, Inc.',
            },
          }),
          { status: 200 },
        );
      },
    );
    const source = new SecEdgarSource(
      'Watcher/1.0 admin@example.com',
      mockFetch,
    );

    await expect(source.lookupCompany('mu')).resolves.toEqual({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
      cik: '0000723125',
    });
    await expect(source.lookupCompany('MU')).resolves.toEqual({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
      cik: '0000723125',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
