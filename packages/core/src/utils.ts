export const clamp = (
  value: number,
  minimum: number,
  maximum: number,
): number => Math.min(maximum, Math.max(minimum, value));

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const recordValue = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

export const parseDate = (
  value: string | number | null | undefined,
): Date | undefined => {
  if (value === null || value === undefined || value === '') return undefined;

  if (typeof value === 'number') {
    const timestamp = value > 99_999_999_999 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const compactDateTime = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  const normalized = compactDateTime
    ? `${compactDateTime[1]}-${compactDateTime[2]}-${compactDateTime[3]}T${compactDateTime[4]}:${compactDateTime[5]}:${compactDateTime[6]}Z`
    : /^\d{8}$/.test(value)
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
};

export const finiteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;

  const parsed = Number(value.replaceAll(/[,$%()\s]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return value.includes('(') ? -parsed : parsed;
};
