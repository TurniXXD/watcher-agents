import { finiteNumber } from '@watcher/core';

export const stringFact = (
  facts: Record<string, unknown>,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value = facts[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

export const numberFact = (
  facts: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = finiteNumber(facts[key]);
    if (value !== null) return value;
  }
  return null;
};

export const booleanFact = (
  facts: Record<string, unknown>,
  ...keys: string[]
): boolean | null => {
  for (const key of keys) {
    const value = facts[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^(true|false)$/i.test(value)) {
      return value.toLowerCase() === 'true';
    }
  }
  return null;
};
