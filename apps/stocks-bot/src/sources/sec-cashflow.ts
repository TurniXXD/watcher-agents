import { z } from 'zod';
import { fetchText } from './utils/http.js';

const dateSchema = z.iso.date();
const factSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  val: z.number().finite(),
  accn: z.string().min(1),
  fy: z.number().int().optional(),
  fp: z.string().optional(),
  form: z.string(),
  filed: dateSchema,
});
const conceptSchema = z.object({
  units: z.record(z.string(), z.array(factSchema)),
});
const companyFactsSchema = z.object({
  facts: z.object({
    'us-gaap': z.record(z.string(), conceptSchema).optional(),
  }),
});

type Fact = z.infer<typeof factSchema>;
type Concepts = z.infer<typeof companyFactsSchema>['facts']['us-gaap'];

export type CashflowPeriod = {
  start: string;
  end: string;
  filed: string;
  form: string;
  accession: string;
  currency: string;
  operating: number;
  investing: number | null;
  financing: number | null;
  capex: number | null;
  freeCashflow: number | null;
};

export type SecCashflow = {
  symbol: string;
  annual: CashflowPeriod[];
  interim: CashflowPeriod | null;
  sourceUrl: string;
};

const tags = {
  operating: ['NetCashProvidedByUsedInOperatingActivities'],
  investing: ['NetCashProvidedByUsedInInvestingActivities'],
  financing: ['NetCashProvidedByUsedInFinancingActivities'],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
  ],
} as const;

const cashflowFacts = (
  concepts: Concepts,
  names: readonly string[],
  currency: string,
): Fact[] => names.flatMap((name) => concepts?.[name]?.units[currency] ?? []);

const isAnnual = (fact: Fact): boolean =>
  /^10-K(?:\/A)?$/u.test(fact.form) && fact.fp === 'FY';

const durationDays = (fact: Fact): number =>
  (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000;

const isInterim = (fact: Fact): boolean => {
  if (!/^10-Q(?:\/A)?$/u.test(fact.form)) return false;
  const days = durationDays(fact);
  if (fact.fp === 'Q1') return days >= 60 && days <= 125;
  if (fact.fp === 'Q2') return days >= 150 && days <= 220;
  if (fact.fp === 'Q3') return days >= 230 && days <= 320;
  return false;
};

const samePeriod = (candidate: Fact, anchor: Fact): boolean =>
  candidate.start === anchor.start &&
  candidate.end === anchor.end &&
  candidate.accn === anchor.accn;

const cashflowPeriod = (
  concepts: Concepts,
  anchor: Fact,
  currency: string,
): CashflowPeriod => {
  const matching = (names: readonly string[]): number | null => {
    for (const name of names) {
      const fact = cashflowFacts(concepts, [name], currency).find((candidate) =>
        samePeriod(candidate, anchor),
      );
      if (fact) return fact.val;
    }
    return null;
  };
  const capex = matching(tags.capex);
  return {
    start: anchor.start,
    end: anchor.end,
    filed: anchor.filed,
    form: anchor.form,
    accession: anchor.accn,
    currency,
    operating: anchor.val,
    investing: matching(tags.investing),
    financing: matching(tags.financing),
    capex,
    freeCashflow: capex !== null && capex >= 0 ? anchor.val - capex : null,
  };
};

export const parseSecCashflow = (
  symbol: string,
  cik: string,
  body: unknown,
): SecCashflow => {
  const parsed = companyFactsSchema.parse(body);
  const concepts = parsed.facts['us-gaap'];
  const operatingUnits = concepts?.[tags.operating[0]]?.units ?? {};
  const candidates = Object.entries(operatingUnits)
    .filter(([currency]) => /^[A-Z]{3}$/u.test(currency))
    .flatMap(([currency, facts]) => facts.map((fact) => ({ fact, currency })))
    .filter(({ fact }) => {
      const days = durationDays(fact);
      return Number.isFinite(days) && days >= 60 && days <= 400;
    })
    .sort(
      (left, right) =>
        right.fact.end.localeCompare(left.fact.end) ||
        right.fact.filed.localeCompare(left.fact.filed) ||
        durationDays(right.fact) - durationDays(left.fact),
    );
  const annual = candidates
    .filter(({ fact }) => isAnnual(fact) && durationDays(fact) >= 300)
    .filter(
      ({ fact }, index, all) =>
        all.findIndex((entry) => entry.fact.end === fact.end) === index,
    )
    .slice(0, 3)
    .map(({ fact, currency }) => cashflowPeriod(concepts, fact, currency));
  const latestInterim = candidates.find(
    ({ fact }) => isInterim(fact) && (!annual[0] || fact.end > annual[0].end),
  );
  return {
    symbol,
    annual,
    interim: latestInterim
      ? cashflowPeriod(concepts, latestInterim.fact, latestInterim.currency)
      : null,
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  };
};

export class SecCashflowClient {
  public constructor(
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!userAgent.trim()) throw new Error('SEC_USER_AGENT is required');
  }

  public async getCashflow(
    symbol: string,
    cik: string,
    signal?: AbortSignal,
  ): Promise<SecCashflow> {
    if (!/^\d{1,10}$/u.test(cik)) throw new Error('Invalid SEC CIK');
    const normalizedCik = cik.padStart(10, '0');
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${normalizedCik}.json`;
    const raw = await fetchText(
      this.fetcher,
      url,
      { 'user-agent': this.userAgent, accept: 'application/json' },
      signal,
    );
    return parseSecCashflow(symbol, normalizedCik, JSON.parse(raw) as unknown);
  }
}

const money = (value: number | null, currency: string): string =>
  value === null
    ? 'neuvedeno'
    : `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(value)} ${currency}`;

const renderPeriod = (title: string, period: CashflowPeriod): string =>
  [
    `${title} · ${period.start} až ${period.end} · ${period.form}`,
    `• Provozní cash flow: ${money(period.operating, period.currency)}`,
    `• Investiční cash flow: ${money(period.investing, period.currency)}`,
    `• Finanční cash flow: ${money(period.financing, period.currency)}`,
    `• Kapitálové výdaje (capex): ${money(period.capex, period.currency)}`,
    `• Volné cash flow (provozní − capex): ${money(period.freeCashflow, period.currency)}`,
    `Podáno SEC: ${period.filed} · accession ${period.accession}`,
  ].join('\n');

export const renderSecCashflow = (report: SecCashflow): string => {
  if (!report.annual.length && !report.interim) {
    return `💵 CASH FLOW · ${report.symbol}\nSEC Company Facts neobsahují použitelné standardizované US-GAAP údaje o provozním cash flow. To neznamená nulové cash flow; zkontrolujte původní výkazy.\nZdroj: ${report.sourceUrl}`;
  }
  return [
    `💵 CASH FLOW · ${report.symbol}`,
    '',
    ...(report.interim
      ? [
          renderPeriod(
            'Poslední průběžné období (od začátku fiskálního roku)',
            report.interim,
          ),
          '',
        ]
      : []),
    ...report.annual.flatMap((period, index) => [
      renderPeriod(
        index === 0 ? 'Poslední fiskální rok' : 'Předchozí fiskální rok',
        period,
      ),
      '',
    ]),
    'Pozn.: průběžné údaje z 10-Q nejsou samostatný kvartál. Volné cash flow je dopočet, jen pokud SEC uvádí capex pro stejné období a podání.',
    `Zdroj: ${report.sourceUrl}`,
  ].join('\n');
};
