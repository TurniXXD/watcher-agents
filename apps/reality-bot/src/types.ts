import { z } from 'zod';

export const realityCategories = [
  'FINANCING',
  'MACRO',
  'PRICES',
  'RENTS',
  'DEVELOPMENT',
  'DEMOGRAPHY',
  'REGULATION',
] as const;

export const realityMetricSchema = z.object({
  externalId: z.string().trim().min(1).max(300),
  source: z.string().trim().min(1).max(100),
  category: z.enum(realityCategories),
  metric: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,79}$/),
  location: z.string().trim().min(1).max(120).optional(),
  disposition: z.string().trim().min(1).max(40).optional(),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(40),
  period: z.coerce.date(),
  observedAt: z.coerce.date(),
  sourceUrl: z.url().optional(),
  raw: z.unknown().optional(),
});

export const realityListingSchema = z.object({
  externalId: z.string().trim().min(1).max(300),
  source: z.string().trim().min(1).max(100),
  url: z.url(),
  title: z.string().trim().min(1).max(500),
  location: z.string().trim().min(1).max(120),
  disposition: z.string().trim().min(1).max(40).optional(),
  priceCzk: z.number().positive().max(1_000_000_000),
  floorAreaM2: z.number().positive().max(10_000),
  estimatedMonthlyRentCzk: z.number().positive().max(10_000_000).optional(),
  annualOwnerCostsCzk: z.number().nonnegative().max(10_000_000).optional(),
  acquisitionCostsCzk: z.number().nonnegative().max(100_000_000).optional(),
  localMedianPricePerM2Czk: z.number().positive().max(10_000_000).optional(),
  publishedAt: z.coerce.date().optional(),
  raw: z.unknown().optional(),
});

export const realityFeedSchema = z.object({
  metrics: z.array(realityMetricSchema).max(20_000).default([]),
  listings: z.array(realityListingSchema).max(50_000).default([]),
});

export const investmentModelSchema = z.object({
  purchasePriceCzk: z.number().positive().default(3_000_000),
  floorAreaM2: z.number().positive().max(1_000).default(60),
  equityPercent: z.number().min(0).max(100).default(30),
  termYears: z.number().int().min(1).max(50).default(30),
  vacancyPercent: z.number().min(0).max(100).default(5),
  annualMaintenancePercent: z.number().min(0).max(20).default(1),
  annualInsuranceCzk: z.number().nonnegative().default(3_000),
  otherAnnualOwnerCostsCzk: z.number().nonnegative().default(0),
});

export type RealityMetric = z.infer<typeof realityMetricSchema>;
export type RealityListing = z.infer<typeof realityListingSchema>;
export type InvestmentModel = z.infer<typeof investmentModelSchema>;

export type SourceFailure = { source: string; error: string };

export type ListingEconomics = {
  grossYieldPercent?: number;
  netYieldPercent?: number;
  pricePerM2Czk: number;
  discountToLocalPercent?: number;
  monthlyPaymentCzk: number;
  monthlyOperatingCostsCzk: number;
  cashflowCzk: number;
  stressCashflows: Record<string, number>;
  daysOnMarket: number;
  previousPriceCzk?: number;
  priceReductionPercent?: number;
  score: number;
};

export type EvaluatedListing = RealityListing & {
  databaseId: string;
  firstSeenAt: Date;
  economics: ListingEconomics;
};

export type ReportPayload = {
  generatedAt: Date;
  marketScore: number;
  verdict: string;
  metrics: RealityMetric[];
  opportunities: EvaluatedListing[];
  sourceFailures: SourceFailure[];
};
