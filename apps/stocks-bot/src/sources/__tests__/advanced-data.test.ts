import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AlphaVantageInstitutionalSource,
  AlphaVantageOptionsSource,
} from '../alpha-vantage-advanced.js';
import { FinraShortInterestSource } from '../finra-short-interest.js';
import {
  StockClinicalTrialsSource,
  StockFdaSource,
} from '../stock-regulatory.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('advanced stock data sources', () => {
  it('aggregates an Alpha Vantage option chain without exposing the API key', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({
          data: [
            {
              contractID: 'MU260918C00100000',
              date: '2026-09-04',
              type: 'call',
              volume: '500',
              open_interest: '100',
              implied_volatility: '0.42',
            },
            {
              contractID: 'MU260918P00100000',
              date: '2026-09-04',
              type: 'put',
              volume: '250',
              open_interest: '500',
              implied_volatility: '0.38',
            },
          ],
        });
      },
    );
    const [item] = await new AlphaVantageOptionsSource(
      'top-secret',
      fetcher,
    ).fetch({ symbol: 'mu' });

    expect(item).toMatchObject({
      source: 'ALPHA_VANTAGE_OPTIONS',
      category: 'OPTIONS_SNAPSHOT',
      normalizedFacts: {
        callVolume: 500,
        putVolume: 250,
        putCallVolumeRatio: 0.5,
        maxVolumeOiRatio: 5,
      },
    });
    expect(JSON.stringify(item)).not.toContain('top-secret');
    const requestedUrl = fetcher.mock.calls[0]?.[0];
    expect(requestedUrl).toBeInstanceOf(URL);
    if (!(requestedUrl instanceof URL)) throw new Error('Expected URL');
    expect(requestedUrl.searchParams.get('function')).toBe('REALTIME_OPTIONS');
  });

  it('normalizes institutional positioning', async () => {
    const source = new AlphaVantageInstitutionalSource(
      'key',
      vi.fn(async () =>
        Response.json({
          data: [
            {
              date: '2026-06-30',
              total_shares: '1200000',
              total_value: '180000000',
              net_share_change: '60000',
              change_percent: '5.26',
              holder_count: '420',
            },
          ],
        }),
      ),
    );

    await expect(source.fetch({ symbol: 'MU' })).resolves.toMatchObject([
      {
        category: 'INSTITUTIONAL_POSITIONING',
        normalizedFacts: {
          totalShares: 1_200_000,
          netShareChange: 60_000,
          changePercent: 5.26,
          holderCount: 420,
        },
      },
    ]);
  });

  it('retries a transient Alpha Vantage transport failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const source = new AlphaVantageInstitutionalSource('key', fetcher);

    const pending = source.fetch({ symbol: 'MU' });
    const assertion = expect(pending).resolves.toEqual([]);
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('posts a ticker filter to FINRA and sorts short interest locally', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json([
          {
            symbolCode: 'MU',
            issueName: 'Micron Technology',
            currentShortPositionQuantity: '20000000',
            previousShortPositionQuantity: '18000000',
            changePreviousNumber: '2000000',
            changePercent: '11.11',
            averageDailyVolumeQuantity: '3500000',
            daysToCoverQuantity: '5.71',
            settlementDate: '2026-08-15',
          },
          {
            symbolCode: 'MU',
            issueName: 'Micron Technology',
            currentShortPositionQuantity: '25000000',
            previousShortPositionQuantity: '20000000',
            changePreviousNumber: '5000000',
            changePercent: '25',
            averageDailyVolumeQuantity: '4000000',
            daysToCoverQuantity: '6.25',
            settlementDate: '2026-08-31',
          },
        ]);
      },
    );
    const [item] = await new FinraShortInterestSource(fetcher).fetch({
      symbol: 'mu',
      maxItems: 1,
    });

    expect(item).toMatchObject({
      source: 'FINRA_SHORT_INTEREST',
      category: 'SHORT_INTEREST_SNAPSHOT',
      primarySource: true,
      publishedAt: new Date('2026-08-31T00:00:00Z'),
      normalizedFacts: { changePercent: 25, daysToCover: 6.25 },
    });
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected JSON body');
    expect(body).toContain('"fieldValue":"MU"');
    expect(body).toContain('"limit":20');
    expect(body).not.toContain('sortFields');
  });

  it('versions ClinicalTrials records by their public update date', async () => {
    const source = new StockClinicalTrialsSource(
      vi.fn(async () =>
        Response.json({
          studies: [
            {
              protocolSection: {
                identificationModule: {
                  nctId: 'NCT12345678',
                  briefTitle: 'A pivotal study',
                },
                descriptionModule: { briefSummary: 'Study summary' },
                statusModule: {
                  overallStatus: 'RECRUITING',
                  lastUpdatePostDateStruct: { date: '2026-09-03' },
                },
                sponsorCollaboratorsModule: {
                  leadSponsor: { name: 'Acme Bio' },
                },
              },
            },
          ],
        }),
      ),
    );

    await expect(
      source.fetch({ symbol: 'ACME', companyName: 'Acme Bio' }),
    ).resolves.toMatchObject([
      {
        externalId: 'NCT12345678:2026-09-03',
        category: 'CLINICAL_TRIAL',
        normalizedFacts: { status: 'RECRUITING', sponsor: 'Acme Bio' },
      },
    ]);
  });

  it('normalizes dated Drugs@FDA submission decisions', async () => {
    const source = new StockFdaSource(
      vi.fn(async () =>
        Response.json({
          results: [
            {
              application_number: 'NDA123456',
              sponsor_name: 'Acme Bio',
              products: [{ brand_name: 'Examplex' }],
              submissions: [
                {
                  submission_type: 'ORIG',
                  submission_number: '1',
                  submission_status: 'AP',
                  submission_status_date: '20260902',
                  review_priority: 'PRIORITY',
                },
              ],
            },
          ],
        }),
      ),
    );

    await expect(
      source.fetch({ symbol: 'ACME', companyName: 'Acme Bio' }),
    ).resolves.toMatchObject([
      {
        category: 'FDA_DECISION',
        primarySource: true,
        normalizedFacts: {
          applicationNumber: 'NDA123456',
          submissionStatus: 'AP',
          products: ['Examplex'],
        },
      },
    ]);
  });
});
