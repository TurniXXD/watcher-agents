export const average = (
  values: readonly (number | null | undefined)[],
): number | null => {
  const present = values.filter(
    (value): value is number => value !== null && value !== undefined,
  );
  return present.length
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
};

export const percentChange = (
  value: number,
  baseline: number,
): number | null =>
  baseline > 0 ? ((value - baseline) / baseline) * 100 : null;
