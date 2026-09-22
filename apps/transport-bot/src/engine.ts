import { checkCompatibility, checkCombinedCargo } from './compatibility.js';
import { calculateConfidence } from './confidence.js';
import { calculateEconomics, incrementalRoute } from './economics.js';
import type { RoutingProvider } from './providers.js';
import { scoreOpportunity, thresholdRejections } from './scoring.js';
import type {
  CostSettings,
  Opportunity,
  OpportunityPreferences,
  PlannedTrip,
  Rejection,
  TransportRequest,
  VehicleProfile,
} from './types.js';

export type EvaluatedOpportunity =
  | { accepted: true; opportunity: Opportunity }
  | { accepted: false; requestIds: string[]; rejections: Rejection[] };

const handlingMinutesPerStop = 10;

const timeWindowRejections = (input: {
  request: TransportRequest;
  departureAt: Date;
  minutesToPickup: number;
  minutesPickupToDelivery: number;
}): Rejection[] => {
  const rejected: Rejection[] = [];
  const pickupArrival = new Date(
    input.departureAt.getTime() + input.minutesToPickup * 60_000,
  );
  const pickupAt = input.request.pickupWindow
    ? new Date(
        Math.max(
          pickupArrival.getTime(),
          input.request.pickupWindow.from.getTime(),
        ),
      )
    : pickupArrival;
  if (input.request.pickupWindow && pickupAt > input.request.pickupWindow.to)
    rejected.push({
      code: 'PICKUP_WINDOW',
      explanation:
        'the route cannot reach pickup before its time window closes',
    });
  const deliveryAt = new Date(
    pickupAt.getTime() +
      (handlingMinutesPerStop + input.minutesPickupToDelivery) * 60_000,
  );
  if (
    input.request.deliveryWindow &&
    deliveryAt > input.request.deliveryWindow.to
  )
    rejected.push({
      code: 'DELIVERY_WINDOW',
      explanation:
        'the route cannot reach delivery before its time window closes',
    });
  if (input.request.expiresAt && input.request.expiresAt < input.departureAt)
    rejected.push({
      code: 'EXPIRED',
      explanation: 'the request expires before departure',
    });
  return rejected;
};

const missingEconomicData = (request: TransportRequest): Rejection[] => [
  ...(!request.pickup || !request.delivery
    ? [
        {
          code: 'MISSING_LOCATION',
          explanation: 'exact pickup or delivery location is unknown',
        },
      ]
    : []),
  ...(request.offeredPrice === undefined
    ? [{ code: 'MISSING_PRICE', explanation: 'offered price is unknown' }]
    : []),
  ...(request.currency !== 'CZK'
    ? [
        {
          code: 'UNSUPPORTED_CURRENCY',
          explanation: `currency ${request.currency} is not yet supported`,
        },
      ]
    : []),
];

export class OpportunityEngine {
  public constructor(private readonly routing: RoutingProvider) {}

  public async evaluateIndividual(input: {
    request: TransportRequest;
    vehicle: VehicleProfile;
    costs: CostSettings;
    preferences: OpportunityPreferences;
  }): Promise<EvaluatedOpportunity> {
    const compatibility = checkCompatibility(input.request, input.vehicle);
    const rejections = missingEconomicData(input.request);
    if (compatibility.classification === 'INCOMPATIBLE')
      rejections.push(
        ...compatibility.reasons.map((explanation) => ({
          code: 'VEHICLE_INCOMPATIBLE',
          explanation,
        })),
      );
    if (rejections.length)
      return {
        accepted: false,
        requestIds: [input.request.externalId],
        rejections,
      };

    const request = input.request as TransportRequest & {
      pickup: NonNullable<TransportRequest['pickup']>;
      delivery: NonNullable<TransportRequest['delivery']>;
      offeredPrice: number;
    };
    const [emptyRoute, loadedRoute] = await Promise.all([
      this.routing.route([input.vehicle.base, request.pickup]),
      this.routing.route([request.pickup, request.delivery]),
    ]);
    const timeFailures = timeWindowRejections({
      request,
      departureAt: new Date(),
      minutesToPickup: emptyRoute.durationMinutes,
      minutesPickupToDelivery: loadedRoute.durationMinutes,
    });
    if (timeFailures.length)
      return {
        accepted: false,
        requestIds: [request.externalId],
        rejections: timeFailures,
      };
    const route = {
      distanceKm: emptyRoute.distanceKm + loadedRoute.distanceKm,
      durationMinutes:
        emptyRoute.durationMinutes +
        loadedRoute.durationMinutes +
        handlingMinutesPerStop * 2,
      tollsCzk: (emptyRoute.tollsCzk ?? 0) + (loadedRoute.tollsCzk ?? 0),
      provider: loadedRoute.provider,
    };
    const economics = calculateEconomics({
      route,
      settings: input.costs,
      consumptionLitersPer100Km: input.vehicle.consumptionLitersPer100Km,
      revenue: request.offeredPrice,
      emptyKm: emptyRoute.distanceKm,
    });
    const withoutScore = {
      kind: 'INDIVIDUAL' as const,
      requests: [request],
      compatibility,
      confidence: calculateConfidence(request),
      route,
      economics,
      warnings: [
        ...compatibility.verificationRequired,
        ...(input.costs.fuelPriceStale ? ['fuel price is cached/stale'] : []),
      ],
    };
    const opportunity = {
      ...withoutScore,
      score: scoreOpportunity(withoutScore),
    };
    const thresholdFailures = thresholdRejections(
      opportunity,
      input.preferences,
    );
    return thresholdFailures.length
      ? {
          accepted: false,
          requestIds: [request.externalId],
          rejections: thresholdFailures,
        }
      : { accepted: true, opportunity };
  }

  public async evaluatePlannedTrip(input: {
    request: TransportRequest;
    trip: PlannedTrip;
    vehicle: VehicleProfile;
    costs: CostSettings;
    preferences: OpportunityPreferences;
    kind?: 'PLANNED_TRIP' | 'RETURN_LOAD';
  }): Promise<EvaluatedOpportunity> {
    const compatibility = checkCompatibility(input.request, input.vehicle);
    const rejections = missingEconomicData(input.request);
    if (compatibility.classification === 'INCOMPATIBLE')
      rejections.push(
        ...compatibility.reasons.map((explanation) => ({
          code: 'VEHICLE_INCOMPATIBLE',
          explanation,
        })),
      );
    if (rejections.length)
      return {
        accepted: false,
        requestIds: [input.request.externalId],
        rejections,
      };
    const request = input.request as TransportRequest & {
      pickup: NonNullable<TransportRequest['pickup']>;
      delivery: NonNullable<TransportRequest['delivery']>;
      offeredPrice: number;
    };
    const [baselineRoute, toPickup, loaded, toDestination] = await Promise.all([
      this.routing.route([input.trip.origin, input.trip.destination]),
      this.routing.route([input.trip.origin, request.pickup]),
      this.routing.route([request.pickup, request.delivery]),
      this.routing.route([request.delivery, input.trip.destination]),
    ]);
    const timeFailures = timeWindowRejections({
      request,
      departureAt: input.trip.departureWindow.from,
      minutesToPickup: toPickup.durationMinutes,
      minutesPickupToDelivery: loaded.durationMinutes,
    });
    if (timeFailures.length)
      return {
        accepted: false,
        requestIds: [request.externalId],
        rejections: timeFailures,
      };
    const modifiedRoute = {
      distanceKm:
        toPickup.distanceKm + loaded.distanceKm + toDestination.distanceKm,
      durationMinutes:
        toPickup.durationMinutes +
        loaded.durationMinutes +
        toDestination.durationMinutes +
        handlingMinutesPerStop * 2,
      tollsCzk:
        (toPickup.tollsCzk ?? 0) +
        (loaded.tollsCzk ?? 0) +
        (toDestination.tollsCzk ?? 0),
      provider: loaded.provider,
    };
    const incremental = incrementalRoute(modifiedRoute, baselineRoute);
    const economics = calculateEconomics({
      route: incremental,
      settings: input.costs,
      consumptionLitersPer100Km: input.vehicle.consumptionLitersPer100Km,
      revenue: request.offeredPrice,
      detourKm: incremental.distanceKm,
    });
    const withoutScore = {
      kind: input.kind ?? ('PLANNED_TRIP' as const),
      requests: [request],
      compatibility,
      confidence: calculateConfidence(request),
      route: modifiedRoute,
      baselineRoute,
      economics,
      warnings: [
        ...compatibility.verificationRequired,
        ...(input.costs.fuelPriceStale ? ['fuel price is cached/stale'] : []),
      ],
    };
    const opportunity = {
      ...withoutScore,
      score: scoreOpportunity(withoutScore),
    };
    const thresholdFailures = thresholdRejections(opportunity, {
      ...input.preferences,
      maximumDetourKm: input.trip.maximumDetourKm,
      maximumAdditionalMinutes: input.trip.maximumAdditionalMinutes,
    });
    if (incremental.durationMinutes > input.trip.maximumAdditionalMinutes)
      thresholdFailures.push({
        code: 'MAXIMUM_ADDITIONAL_TIME',
        explanation: `${Math.round(incremental.durationMinutes)} additional minutes > configured ${input.trip.maximumAdditionalMinutes} minutes`,
      });
    return thresholdFailures.length
      ? {
          accepted: false,
          requestIds: [request.externalId],
          rejections: thresholdFailures,
        }
      : { accepted: true, opportunity };
  }

  public validateCombination(
    requests: readonly TransportRequest[],
    vehicle: VehicleProfile,
  ) {
    return checkCombinedCargo(requests, vehicle);
  }
}
