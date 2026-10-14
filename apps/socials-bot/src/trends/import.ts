import { assertPublicHttpUrl } from '@watcher/core';
import { z } from 'zod';
import {
  safeExternalExcerpt,
  trendSignalSchema,
  type TrendSignal,
} from './types.js';

const importedRowSchema = z.object({
  source: z
    .enum(['GOOGLE_TRENDS', 'TIKTOK', 'INSTAGRAM', 'MANUAL'])
    .default('MANUAL'),
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  title: z.string().trim().min(2).max(500),
  url: z.string().trim().min(1),
  description: z.string().optional(),
  region: z.enum(['US', 'CZ', 'GLOBAL', 'UNKNOWN']).default('UNKNOWN'),
  publishedAt: z.string().optional(),
  views: z.coerce.number().int().nonnegative().optional(),
  likes: z.coerce.number().int().nonnegative().optional(),
  comments: z.coerce.number().int().nonnegative().optional(),
  shares: z.coerce.number().int().nonnegative().optional(),
  searchInterest: z.coerce.number().nonnegative().optional(),
});

const csvRows = (value: string): Array<Record<string, string>> => {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) records.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) records.push(row);
  const headers = records.shift()?.map((header) => header.trim()) ?? [];
  return records.map((record) =>
    Object.fromEntries(
      headers.map((header, index) => [header, record[index] ?? '']),
    ),
  );
};

export const parseTrendImport = (
  value: string,
  now = new Date(),
): TrendSignal[] => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  let raw: unknown;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    raw = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && 'items' in parsed
        ? parsed.items
        : [parsed];
  } else {
    raw = csvRows(trimmed);
  }
  const rows = z.array(importedRowSchema).max(500).parse(raw);
  return rows.map((row, index) => {
    const sourceUrl = assertPublicHttpUrl(row.url).toString();
    const publishedAt = row.publishedAt ? new Date(row.publishedAt) : undefined;
    if (publishedAt && Number.isNaN(publishedAt.getTime())) {
      throw new Error(`Invalid publishedAt in imported row ${index + 1}`);
    }
    return trendSignalSchema.parse({
      externalId: row.id ?? `${row.source}:${sourceUrl}`,
      source: row.source,
      sourceUrl,
      title: row.title,
      ...(safeExternalExcerpt(row.description)
        ? { description: safeExternalExcerpt(row.description) }
        : {}),
      region: row.region,
      ...(publishedAt ? { publishedAt } : {}),
      collectedAt: now,
      metrics: {
        ...(row.views === undefined ? {} : { views: row.views }),
        ...(row.likes === undefined ? {} : { likes: row.likes }),
        ...(row.comments === undefined ? {} : { comments: row.comments }),
        ...(row.shares === undefined ? {} : { shares: row.shares }),
        ...(row.searchInterest === undefined
          ? {}
          : { searchInterest: row.searchInterest }),
      },
      metadata: {
        importedManually: true,
        metricsCaveat:
          'Imported metrics were supplied by the operator and were not independently verified.',
      },
    });
  });
};
