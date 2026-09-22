import type { DataConfidence, TransportRequest } from './types.js';

export const calculateConfidence = (
  request: TransportRequest,
): DataConfidence => {
  const hasPhysicalData = Boolean(
    request.cargo.weightKg &&
    (request.cargo.volumeM3 ||
      (request.cargo.lengthCm &&
        request.cargo.widthCm &&
        request.cargo.heightCm) ||
      request.cargo.palletCount),
  );
  if (
    request.offeredPrice === undefined ||
    !request.pickup ||
    !request.delivery ||
    !hasPhysicalData
  )
    return 'LOW';

  const optionalMissing = [
    request.pickupWindow,
    request.deliveryWindow,
    request.cargo.volumeM3,
    request.cargo.palletCount,
  ].filter((value) => value === undefined).length;
  return optionalMissing <= 1 ? 'HIGH' : 'MEDIUM';
};
