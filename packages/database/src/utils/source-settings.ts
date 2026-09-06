import { recordValue } from '@watcher/core';
import type { DatabaseClient } from '../client.js';
import { PublicationSourceType } from '../generated/prisma/enums.js';
import { defaultStockSourceTypes } from '../stock-source-defaults.js';

export type SourceSetting = { source: string; enabled: boolean };

export const sourceSettingsRecord = (
  value: unknown,
): Record<string, boolean> => {
  const record = recordValue(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
};

export const effectiveSourceEnabled = (
  settings: Record<string, boolean>,
  source: string,
  existingValues: boolean[],
): boolean =>
  settings[source] ??
  (existingValues.length === 0 || existingValues.every(Boolean));

export const effectiveSourceSettings = <TSource extends string>(
  sources: readonly TSource[],
  rawSettings: unknown,
  existingValues: ReadonlyMap<TSource, boolean[]>,
): Array<{ source: TSource; enabled: boolean }> => {
  const settings = sourceSettingsRecord(rawSettings);
  return sources.map((source) => ({
    source,
    enabled: effectiveSourceEnabled(
      settings,
      source,
      existingValues.get(source) ?? [],
    ),
  }));
};

const valuesBySource = <TSource extends string>(
  rows: Array<{ source: TSource; enabled: boolean }>,
): Map<TSource, boolean[]> => {
  const values = new Map<TSource, boolean[]>();
  for (const row of rows) {
    const existing = values.get(row.source);
    if (existing) existing.push(row.enabled);
    else values.set(row.source, [row.enabled]);
  }
  return values;
};

export const stockSourceSettingsForChat = async (
  db: DatabaseClient,
  chatConfigId: string,
) => {
  const [watcher, rows] = await Promise.all([
    db.watcherConfig.findUniqueOrThrow({
      where: { chatConfigId },
      select: { sourceSettings: true },
    }),
    db.stockSourceConfig.findMany({
      where: { stock: { chatConfigId } },
      select: { source: true, enabled: true },
    }),
  ]);
  return effectiveSourceSettings(
    defaultStockSourceTypes,
    watcher.sourceSettings,
    valuesBySource(rows),
  );
};

export const publicationSourceSettingsForChat = async (
  db: DatabaseClient,
  chatConfigId: string,
) => {
  const [watcher, rows] = await Promise.all([
    db.watcherConfig.findUniqueOrThrow({
      where: { chatConfigId },
      select: { sourceSettings: true },
    }),
    db.publicationSourceConfig.findMany({
      where: { query: { chatConfigId } },
      select: { source: true, enabled: true },
    }),
  ]);
  return effectiveSourceSettings(
    Object.values(PublicationSourceType),
    watcher.sourceSettings,
    valuesBySource(rows),
  );
};
