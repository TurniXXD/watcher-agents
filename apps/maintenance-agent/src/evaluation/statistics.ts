export const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
};

export const percentile = (values: number[], quantile: number): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

export const mad = (values: number[]): number | undefined => {
  const center = median(values);
  return center === undefined
    ? undefined
    : median(values.map((value) => Math.abs(value - center)));
};

export const rollingBaseline = (values: number[]) => ({
  count: values.length,
  median: median(values),
  mad: mad(values),
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: values.length >= 100 ? percentile(values, 0.99) : undefined,
});

export const configDiff = <T>(from: T, to: T) => ({ from, to });
