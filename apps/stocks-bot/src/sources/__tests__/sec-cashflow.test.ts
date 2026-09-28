import { describe, expect, it, vi } from 'vitest';
import {
  SecCashflowClient,
  parseSecCashflow,
  renderSecCashflow,
} from '../sec-cashflow.js';

const annual = {
  start: '2024-09-01',
  end: '2025-08-31',
  val: 1_200,
  accn: '000100-25-000001',
  fy: 2025,
  fp: 'FY',
  form: '10-K',
  filed: '2025-10-10',
};

const interim = {
  start: '2025-09-01',
  end: '2026-02-28',
  val: 500,
  accn: '000100-26-000002',
  fy: 2026,
  fp: 'Q2',
  form: '10-Q',
  filed: '2026-03-15',
};

const concept = (facts: unknown[]) => ({ units: { USD: facts } });
const companyFacts = {
  facts: {
    'us-gaap': {
      NetCashProvidedByUsedInOperatingActivities: concept([
        annual,
        { ...annual, val: 1_100, filed: '2025-09-30' },
        { ...interim, start: '2025-12-01', val: 250 },
        interim,
      ]),
      NetCashProvidedByUsedInInvestingActivities: concept([
        { ...annual, val: -300 },
        { ...interim, val: -180 },
      ]),
      NetCashProvidedByUsedInFinancingActivities: concept([
        { ...annual, val: -100 },
        { ...interim, val: 40 },
      ]),
      PaymentsToAcquirePropertyPlantAndEquipment: concept([
        { ...annual, val: 200 },
        { ...interim, val: 150 },
      ]),
    },
  },
};

describe('SEC cash-flow report', () => {
  it('keeps filing-matched annual and fiscal-YTD facts separate', () => {
    const report = parseSecCashflow('MU', '0000000100', companyFacts);

    expect(report.annual).toHaveLength(1);
    expect(report.annual[0]).toMatchObject({
      operating: 1_200,
      investing: -300,
      financing: -100,
      capex: 200,
      freeCashflow: 1_000,
    });
    expect(report.interim).toMatchObject({
      start: '2025-09-01',
      end: '2026-02-28',
      operating: 500,
      capex: 150,
      freeCashflow: 350,
    });
    expect(renderSecCashflow(report)).toContain(
      'Poslední průběžné období (od začátku fiskálního roku)',
    );
    expect(renderSecCashflow(report)).toContain('Zdroj: https://data.sec.gov');
  });

  it('never borrows capex from another filing and never turns missing values into zero', () => {
    const body = {
      facts: {
        'us-gaap': {
          NetCashProvidedByUsedInOperatingActivities: concept([annual]),
          PaymentsToAcquirePropertyPlantAndEquipment: concept([
            { ...annual, accn: 'different-accession', val: 200 },
          ]),
        },
      },
    };
    const report = parseSecCashflow('MU', '0000000100', body);

    expect(report.annual[0]?.capex).toBeNull();
    expect(report.annual[0]?.freeCashflow).toBeNull();
    expect(renderSecCashflow(report)).toContain('neuvedeno');
  });

  it('does not label a standalone Q2 quarter as fiscal-year-to-date', () => {
    const report = parseSecCashflow('MU', '0000000100', {
      facts: {
        'us-gaap': {
          NetCashProvidedByUsedInOperatingActivities: concept([
            { ...interim, start: '2025-12-01', val: 250 },
          ]),
        },
      },
    });
    expect(report.interim).toBeNull();
  });

  it('explains missing standardized cash-flow facts', () => {
    const report = parseSecCashflow('MU', '0000000100', {
      facts: { 'us-gaap': {} },
    });
    expect(report.annual).toEqual([]);
    expect(report.interim).toBeNull();
    expect(renderSecCashflow(report)).toContain('neznamená nulové cash flow');
  });

  it('fetches only the fixed official SEC Company Facts URL with an identifying user agent', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(companyFacts), { status: 200 }),
    );
    const client = new SecCashflowClient('Watcher test@example.com', fetcher);

    const report = await client.getCashflow('MU', '100');

    expect(report.annual[0]?.operating).toBe(1_200);
    expect(fetcher).toHaveBeenCalledWith(
      'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000100.json',
      expect.objectContaining({
        headers: {
          'user-agent': 'Watcher test@example.com',
          accept: 'application/json',
        },
      }),
    );
    await expect(client.getCashflow('MU', '100/evil')).rejects.toThrow(
      'Invalid SEC CIK',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
