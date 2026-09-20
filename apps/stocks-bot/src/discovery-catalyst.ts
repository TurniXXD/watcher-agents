import type { WatchItem } from '@watcher/core';
import type { OllamaProvider, StructuredJsonSchema } from '@watcher/llm';
import { z } from 'zod';

const assessmentSchema = z.object({
  qualifies: z.boolean(),
  catalyst: z.string().min(1).max(500),
  direction: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']),
  catalystStrength: z.number().int().min(0).max(10),
  confirmation: z.enum([
    'NONE',
    'SINGLE_SOURCE',
    'INDEPENDENT_SOURCES',
    'OFFICIAL_SOURCE',
  ]),
  upsidePotential: z.number().int().min(0).max(10),
  pricedIn: z.enum([
    'NOT_PRICED_IN',
    'PARTIALLY_PRICED_IN',
    'MOSTLY_PRICED_IN',
    'OVERPRICED_EXPECTATIONS',
    'UNKNOWN',
  ]),
  explanation: z.string().min(1).max(1_000),
  risks: z.array(z.string().min(1).max(300)).max(5),
});

const assessmentJsonSchema: StructuredJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'qualifies',
    'catalyst',
    'direction',
    'catalystStrength',
    'confirmation',
    'upsidePotential',
    'pricedIn',
    'explanation',
    'risks',
  ],
  properties: {
    qualifies: { type: 'boolean' },
    catalyst: { type: 'string' },
    direction: { enum: ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] },
    catalystStrength: { type: 'integer', minimum: 0, maximum: 10 },
    confirmation: {
      enum: ['NONE', 'SINGLE_SOURCE', 'INDEPENDENT_SOURCES', 'OFFICIAL_SOURCE'],
    },
    upsidePotential: { type: 'integer', minimum: 0, maximum: 10 },
    pricedIn: {
      enum: [
        'NOT_PRICED_IN',
        'PARTIALLY_PRICED_IN',
        'MOSTLY_PRICED_IN',
        'OVERPRICED_EXPECTATIONS',
        'UNKNOWN',
      ],
    },
    explanation: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
};

export type DiscoveryCatalystAssessment = z.infer<typeof assessmentSchema>;

export const discoveryOpportunityScore = (
  assessment: DiscoveryCatalystAssessment,
  changePercent: number,
): number => {
  const confirmationScore = {
    NONE: 0,
    SINGLE_SOURCE: 1,
    INDEPENDENT_SOURCES: 2,
    OFFICIAL_SOURCE: 3,
  }[assessment.confirmation];
  const pricedInPenalty = {
    NOT_PRICED_IN: 0,
    PARTIALLY_PRICED_IN: 8,
    MOSTLY_PRICED_IN: 18,
    OVERPRICED_EXPECTATIONS: 30,
    UNKNOWN: 12,
  }[assessment.pricedIn];
  const movePenalty = Math.min(20, Math.floor(Math.abs(changePercent) / 5));
  return Math.max(
    0,
    Math.min(
      100,
      assessment.catalystStrength * 5 +
        assessment.upsidePotential * 3 +
        confirmationScore * 5 -
        pricedInPenalty -
        movePenalty,
    ),
  );
};

const articleText = (article: WatchItem): string =>
  [
    `Source: ${article.source}`,
    `Published: ${article.publishedAt?.toISOString() ?? 'unknown'}`,
    `Headline: ${article.title}`,
    `Content: ${article.content.slice(0, 2_000)}`,
  ].join('\n');

export class DiscoveryCatalystAnalyzer {
  public constructor(private readonly llm: OllamaProvider) {}

  public async assess(
    input: {
      ticker: string;
      companyName: string;
      changePercent: number;
      articles: readonly WatchItem[];
    },
    signal?: AbortSignal,
  ): Promise<DiscoveryCatalystAssessment> {
    const articles = input.articles
      .slice(0, 5)
      .map(articleText)
      .join('\n\n---\n\n');
    return this.llm.generateStructured(
      `Assess whether this company has a fresh, factual upside catalyst worth researching.\n\nCompany: ${input.companyName} (${input.ticker})\nCurrent market move: ${input.changePercent >= 0 ? '+' : ''}${input.changePercent.toFixed(2)}%\n\nSource articles:\n${articles}\n\nRules:\n- Use only the supplied articles; do not infer missing facts.\n- A price move alone is never a catalyst.\n- Set qualifies=false for rumours, generic market commentary, stale stories, unconfirmed claims, negative/neutral news, or when the likely upside is already priced in.\n- Confirmation is OFFICIAL_SOURCE only for a company, regulator, or filing source explicitly evidenced in the articles; INDEPENDENT_SOURCES requires corroboration from distinct named sources.\n- Compare the current move with the remaining upside if the catalyst is confirmed. Large moves should normally be MOSTLY_PRICED_IN or OVERPRICED_EXPECTATIONS unless the supplied evidence demonstrates substantial remaining value.\n- Be conservative: this is a research shortlist, not a trade recommendation.`,
      assessmentJsonSchema,
      assessmentSchema,
      signal,
      { numPredict: 320 },
    );
  }
}
