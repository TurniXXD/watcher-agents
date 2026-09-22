import { z } from 'zod';

export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const locationSchema = coordinateSchema.extend({
  address: z.string().trim().min(2).max(300),
});

export const timeWindowSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const cargoSchema = z.object({
  description: z.string().trim().min(1).max(1_000),
  weightKg: z.number().positive().optional(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  volumeM3: z.number().positive().optional(),
  palletCount: z.number().int().nonnegative().optional(),
  specialRequirements: z.array(z.string().trim().min(1).max(100)).default([]),
});

export const transportRequestSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(100),
  sourceUrl: z.url().optional(),
  pickup: locationSchema.optional(),
  delivery: locationSchema.optional(),
  pickupWindow: timeWindowSchema.optional(),
  deliveryWindow: timeWindowSchema.optional(),
  cargo: cargoSchema,
  offeredPrice: z.number().nonnegative().optional(),
  currency: z.string().trim().length(3).default('CZK'),
  publishedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  raw: z.unknown(),
});

export type Coordinate = z.infer<typeof coordinateSchema>;
export type Location = z.infer<typeof locationSchema>;
export type TimeWindow = z.infer<typeof timeWindowSchema>;
export type Cargo = z.infer<typeof cargoSchema>;
export type TransportRequest = z.infer<typeof transportRequestSchema>;

export type VehicleProfile = {
  manufacturer: string;
  model: string;
  year: number;
  fuelType: string;
  consumptionLitersPer100Km: number;
  maximumPermittedWeightKg: number;
  curbWeightKg: number;
  maximumPayloadKg: number;
  cargoLengthCm: number;
  cargoWidthCm: number;
  cargoHeightCm: number;
  usableVolumeM3: number;
  maximumEuroPallets: number;
  restrictions: string[];
  base: Location;
};

export type CostSettings = {
  fuelPriceCzkPerLiter: number;
  fuelPriceSource: string;
  fuelPriceUpdatedAt: Date;
  fuelPriceStale: boolean;
  wearCzkPerKm: number;
  maintenanceCzkPerKm: number;
  tyresCzkPerKm: number;
  oilCzkPerKm: number;
  insuranceCzkPerKm: number;
  driverCzkPerHour: number;
};

export type OpportunityPreferences = {
  minimumProfitCzk: number;
  minimumProfitPerHourCzk: number;
  maximumEmptyKm: number;
  maximumDetourKm: number;
  maximumAdditionalMinutes: number;
  minimumConfidence: DataConfidence;
  multiplePickups: boolean;
};

export type RouteResult = {
  distanceKm: number;
  durationMinutes: number;
  geometry?: string;
  tollsCzk?: number;
  provider: string;
};

export type CostBreakdown = {
  fuelCost: number;
  wearCost: number;
  maintenanceCost: number;
  tyreCost: number;
  oilCost: number;
  insuranceCost: number;
  driverCost: number;
  tollCost: number;
  otherExpenses: number;
  variableVehicleCost: number;
  estimatedTotalCost: number;
  revenue: number;
  profit: number;
  profitPerKm: number;
  profitPerHour: number;
  revenuePerKm: number;
  emptyKm: number;
  detourKm: number;
};

export type Compatibility =
  'COMPATIBLE' | 'POSSIBLY_COMPATIBLE' | 'INCOMPATIBLE';
export type DataConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type CompatibilityResult = {
  classification: Compatibility;
  reasons: string[];
  verificationRequired: string[];
};

export type Rejection = {
  code: string;
  explanation: string;
};

export type Opportunity = {
  kind: 'INDIVIDUAL' | 'PLANNED_TRIP' | 'RETURN_LOAD' | 'COMBINATION';
  requests: TransportRequest[];
  compatibility: CompatibilityResult;
  confidence: DataConfidence;
  route: RouteResult;
  baselineRoute?: RouteResult;
  economics: CostBreakdown;
  score: number;
  warnings: string[];
};

export type PlannedTrip = {
  origin: Location;
  destination: Location;
  departureWindow: TimeWindow;
  maximumDetourKm: number;
  maximumAdditionalMinutes: number;
  multiplePickups: boolean;
};
