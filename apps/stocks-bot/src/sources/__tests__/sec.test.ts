import { describe, expect, it, vi } from 'vitest';
import { SecEdgarSource } from '../sec.js';

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

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

  it('enriches company universe metadata from SEC submissions', async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('company_tickers.json')) {
        return Response.json({
          '0': {
            cik_str: 723125,
            ticker: 'MU',
            title: 'Micron Technology, Inc.',
          },
        });
      }
      return Response.json({
        name: 'MICRON TECHNOLOGY INC',
        tickers: ['MU'],
        exchanges: ['Nasdaq'],
        sicDescription: 'Semiconductors & Related Device Manufacturing',
        website: 'https://www.micron.com/',
        investorWebsite: 'https://investors.micron.com/',
        filings: {
          recent: {
            accessionNumber: [],
            filingDate: [],
            form: [],
            primaryDocument: [],
            primaryDocDescription: [],
          },
        },
      });
    });
    const source = new SecEdgarSource(
      'Watcher/1.0 admin@example.com',
      mockFetch,
    );

    await expect(source.lookupCompanyProfile('MU')).resolves.toEqual({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
      cik: '0000723125',
      exchange: 'Nasdaq',
      industry: 'Semiconductors & Related Device Manufacturing',
      investorRelationsUrl: 'https://investors.micron.com/',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('extracts structured Form 4 transaction facts from the primary filing', async () => {
    const form4 = `<?xml version="1.0"?>
      <ownershipDocument>
        <reportingOwner><reportingOwnerId><rptOwnerName>Jane Doe</rptOwnerName></reportingOwnerId>
          <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><isTenPercentOwner>0</isTenPercentOwner><officerTitle>Chief Financial Officer</officerTitle></reportingOwnerRelationship>
        </reportingOwner>
        <nonDerivativeTransaction>
          <transactionDate><value>2026-09-01</value></transactionDate>
          <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
          <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>100</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
          <postTransactionAmounts><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
        </nonDerivativeTransaction>
        <footnotes><footnote id="F1">Pursuant to a Rule 10b5-1 trading plan.</footnote></footnotes>
      </ownershipDocument>`;
    const fetcher = vi.fn(async () =>
      fetcher.mock.calls.length === 1
        ? Response.json({
            name: 'MICRON TECHNOLOGY INC',
            filings: {
              recent: {
                accessionNumber: ['0000000000-26-000001'],
                filingDate: ['2026-09-03'],
                form: ['4'],
                primaryDocument: ['form4.xml'],
                primaryDocDescription: ['FORM 4'],
              },
            },
          })
        : new Response(form4),
    );
    const source = new SecEdgarSource('Watcher/1.0 admin@example.com', fetcher);

    const [item] = await source.fetch({ symbol: 'MU', cik: '723125' });

    expect(item?.normalizedFacts).toMatchObject({
      form: '4',
      owner: 'Jane Doe',
      officerTitle: 'Chief Financial Officer',
      isOfficer: true,
      transactionDate: '2026-09-01',
      transactionCode: 'S',
      acquiredDisposedCode: 'D',
      shares: '1000',
      pricePerShare: '100',
      sharesOwnedFollowing: '9000',
      footnotes: 'Pursuant to a Rule 10b5-1 trading plan.',
    });
  });
});
