/** Canonical JSON used to compare bot snapshots with editorial values. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(normalize(value));

const normalize = (value: unknown): unknown => {
  if (value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.length === 0 ? null : value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return value;
};

export const sameValue = (a: unknown, b: unknown): boolean =>
  canonicalJson(a) === canonicalJson(b);

/** Safe string conversion for loosely typed hook and route values. */
export const asText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
