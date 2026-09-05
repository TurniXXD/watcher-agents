import { recordValue } from '@watcher/core';
import type { Prisma } from './generated/prisma/client.js';

export const prismaJson = (value: unknown): Prisma.InputJsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return {};
  }
  const parsed: unknown = JSON.parse(serialized);
  return parsed as Prisma.InputJsonValue;
};

export const jsonObject = (value: Prisma.JsonValue): Record<string, unknown> =>
  recordValue(value);

export const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
