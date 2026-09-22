import type {
  Cargo,
  CompatibilityResult,
  TransportRequest,
  VehicleProfile,
} from './types.js';

const fitsBox = (cargo: Cargo, vehicle: VehicleProfile): boolean => {
  if (!cargo.lengthCm || !cargo.widthCm || !cargo.heightCm) return false;
  if (cargo.heightCm > vehicle.cargoHeightCm) return false;
  return (
    (cargo.lengthCm <= vehicle.cargoLengthCm &&
      cargo.widthCm <= vehicle.cargoWidthCm) ||
    (cargo.widthCm <= vehicle.cargoLengthCm &&
      cargo.lengthCm <= vehicle.cargoWidthCm)
  );
};

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('en');

export const checkCompatibility = (
  request: TransportRequest,
  vehicle: VehicleProfile,
): CompatibilityResult => {
  const reasons: string[] = [];
  const verificationRequired: string[] = [];
  const { cargo } = request;

  if (cargo.weightKg === undefined) verificationRequired.push('cargo weight');
  else if (cargo.weightKg > vehicle.maximumPayloadKg)
    reasons.push(
      `payload exceeded by ${Math.ceil(cargo.weightKg - vehicle.maximumPayloadKg)} kg`,
    );

  const hasDimensions = Boolean(
    cargo.lengthCm && cargo.widthCm && cargo.heightCm,
  );
  if (!hasDimensions) verificationRequired.push('cargo dimensions');
  else if (!fitsBox(cargo, vehicle))
    reasons.push('cargo bounding dimensions do not fit');

  if (cargo.volumeM3 === undefined) verificationRequired.push('cargo volume');
  else if (cargo.volumeM3 > vehicle.usableVolumeM3)
    reasons.push(
      `cargo volume exceeds usable volume by ${(cargo.volumeM3 - vehicle.usableVolumeM3).toFixed(2)} m³`,
    );

  if (cargo.palletCount === undefined)
    verificationRequired.push('pallet count');
  else if (cargo.palletCount > vehicle.maximumEuroPallets)
    reasons.push(
      `${cargo.palletCount} pallets exceed the ${vehicle.maximumEuroPallets}-pallet limit`,
    );

  const restrictions = new Set(vehicle.restrictions.map(normalize));
  const unmet = cargo.specialRequirements.filter(
    (requirement) => !restrictions.has(normalize(requirement)),
  );
  if (unmet.length)
    verificationRequired.push(...unmet.map((item) => `requirement: ${item}`));

  return {
    classification: reasons.length
      ? 'INCOMPATIBLE'
      : verificationRequired.length
        ? 'POSSIBLY_COMPATIBLE'
        : 'COMPATIBLE',
    reasons,
    verificationRequired,
  };
};

export const checkCombinedCargo = (
  requests: readonly TransportRequest[],
  vehicle: VehicleProfile,
): CompatibilityResult => {
  const individual = requests.map((request) =>
    checkCompatibility(request, vehicle),
  );
  const reasons = individual.flatMap((result) => result.reasons);
  const verificationRequired = individual.flatMap(
    (result) => result.verificationRequired,
  );
  const sum = (selector: (cargo: Cargo) => number | undefined) =>
    requests.reduce(
      (total, request) => total + (selector(request.cargo) ?? 0),
      0,
    );
  const allKnown = (selector: (cargo: Cargo) => number | undefined) =>
    requests.every((request) => selector(request.cargo) !== undefined);

  if (allKnown((cargo) => cargo.weightKg)) {
    const weight = sum((cargo) => cargo.weightKg);
    if (weight > vehicle.maximumPayloadKg)
      reasons.push(
        `combined payload exceeded by ${Math.ceil(weight - vehicle.maximumPayloadKg)} kg`,
      );
  }
  if (allKnown((cargo) => cargo.volumeM3)) {
    const volume = sum((cargo) => cargo.volumeM3);
    if (volume > vehicle.usableVolumeM3)
      reasons.push(
        `combined cargo volume exceeds capacity by ${(volume - vehicle.usableVolumeM3).toFixed(2)} m³`,
      );
  }
  if (allKnown((cargo) => cargo.palletCount)) {
    const pallets = sum((cargo) => cargo.palletCount);
    if (pallets > vehicle.maximumEuroPallets)
      reasons.push(
        `combined pallet count exceeds capacity by ${pallets - vehicle.maximumEuroPallets}`,
      );
  }

  // Conservative two-dimensional shelf packing. Every item must have a known
  // bounding box; no load is declared compatible from weight alone.
  const boxes = requests.flatMap((request) => {
    const { lengthCm, widthCm, heightCm } = request.cargo;
    return lengthCm && widthCm && heightCm
      ? [{ lengthCm, widthCm, heightCm }]
      : [];
  });
  if (boxes.length === requests.length) {
    let usedLength = 0;
    let shelfWidth = 0;
    let shelfLength = 0;
    for (const box of boxes.sort((a, b) => b.widthCm - a.widthCm)) {
      const orientations = [
        { length: box.lengthCm, width: box.widthCm },
        { length: box.widthCm, width: box.lengthCm },
      ].filter(
        ({ length, width }) =>
          length <= vehicle.cargoLengthCm && width <= vehicle.cargoWidthCm,
      );
      const orientation = orientations.sort((a, b) => a.width - b.width)[0];
      if (!orientation || box.heightCm > vehicle.cargoHeightCm) {
        reasons.push('combined cargo contains a box that cannot fit');
        break;
      }
      if (shelfWidth + orientation.width > vehicle.cargoWidthCm) {
        usedLength += shelfLength;
        shelfWidth = 0;
        shelfLength = 0;
      }
      shelfWidth += orientation.width;
      shelfLength = Math.max(shelfLength, orientation.length);
    }
    if (usedLength + shelfLength > vehicle.cargoLengthCm)
      reasons.push('combined cargo cannot be packed in the cargo floor');
  }

  const uniqueVerification = [...new Set(verificationRequired)];
  return {
    classification: reasons.length
      ? 'INCOMPATIBLE'
      : uniqueVerification.length
        ? 'POSSIBLY_COMPATIBLE'
        : 'COMPATIBLE',
    reasons: [...new Set(reasons)],
    verificationRequired: uniqueVerification,
  };
};
