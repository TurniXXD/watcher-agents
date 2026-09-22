import { z } from 'zod';
import { locationSchema, timeWindowSchema } from './types.js';

export const vehicleProfileSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  year: z
    .number()
    .int()
    .min(1950)
    .max(new Date().getFullYear() + 1),
  fuelType: z.string().min(1),
  consumptionLitersPer100Km: z.number().positive().max(100),
  maximumPermittedWeightKg: z.number().positive(),
  curbWeightKg: z.number().positive(),
  maximumPayloadKg: z.number().positive(),
  cargoLengthCm: z.number().positive(),
  cargoWidthCm: z.number().positive(),
  cargoHeightCm: z.number().positive(),
  usableVolumeM3: z.number().positive(),
  maximumEuroPallets: z.number().int().nonnegative(),
  restrictions: z.array(z.string()),
  base: locationSchema,
});

export const costSettingsSchema = z.object({
  fuelPriceCzkPerLiter: z.number().positive(),
  fuelPriceSource: z.string().min(1),
  fuelPriceUpdatedAt: z.coerce.date(),
  fuelPriceStale: z.boolean(),
  wearCzkPerKm: z.number().nonnegative(),
  maintenanceCzkPerKm: z.number().nonnegative(),
  tyresCzkPerKm: z.number().nonnegative(),
  oilCzkPerKm: z.number().nonnegative(),
  insuranceCzkPerKm: z.number().nonnegative(),
  driverCzkPerHour: z.number().nonnegative(),
});

export const preferencesSchema = z.object({
  minimumProfitCzk: z.number().nonnegative(),
  minimumProfitPerHourCzk: z.number().nonnegative(),
  maximumEmptyKm: z.number().nonnegative(),
  maximumDetourKm: z.number().nonnegative(),
  maximumAdditionalMinutes: z.number().nonnegative(),
  minimumConfidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  multiplePickups: z.boolean(),
});

export const plannedTripSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
  departureWindow: timeWindowSchema,
  maximumDetourKm: z.number().nonnegative(),
  maximumAdditionalMinutes: z.number().nonnegative(),
  multiplePickups: z.boolean(),
});

export const defaultPreferences = {
  minimumProfitCzk: 1_000,
  minimumProfitPerHourCzk: 400,
  maximumEmptyKm: 40,
  maximumDetourKm: 30,
  maximumAdditionalMinutes: 60,
  minimumConfidence: 'MEDIUM' as const,
  multiplePickups: false,
};

export const defaultCostRates = {
  wearCzkPerKm: 2.5,
  maintenanceCzkPerKm: 1.8,
  tyresCzkPerKm: 0.6,
  oilCzkPerKm: 0.25,
  insuranceCzkPerKm: 0.8,
  driverCzkPerHour: 0,
};
