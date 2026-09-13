export const clamp = (
  value: number,
  minimum: number,
  maximum: number,
): number => Math.min(maximum, Math.max(minimum, value));

export const errorMessage = (error: unknown): string => {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const message =
      current instanceof Error
        ? current.message
        : typeof current === 'object' && 'message' in current
          ? String(current.message)
          : typeof current === 'string' ||
              typeof current === 'number' ||
              typeof current === 'boolean' ||
              typeof current === 'bigint'
            ? String(current)
            : 'Unknown error';
    const code =
      typeof current === 'object' &&
      'code' in current &&
      typeof current.code === 'string'
        ? current.code
        : undefined;
    if (message && !parts.includes(message)) parts.push(message);
    if (code && !parts.includes(code)) parts.push(code);
    current =
      typeof current === 'object' && 'cause' in current
        ? current.cause
        : undefined;
  }
  return parts.slice(0, 8).join(' — ');
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const recordValue = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

export const removeNullBytes = (value: string): string =>
  value.replaceAll('\u0000', '');

export const removeNullBytesDeep = (value: unknown): unknown => {
  if (typeof value === 'string') return removeNullBytes(value);
  if (Array.isArray(value)) return value.map(removeNullBytesDeep);
  if (!isRecord(value)) return value;

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      removeNullBytes(key),
      removeNullBytesDeep(entry),
    ]),
  );
};

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
