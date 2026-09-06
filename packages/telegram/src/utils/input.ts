import { z } from 'zod';

export const stockSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/);

export const publicationQuerySchema = z.string().trim().min(2).max(200);

export const commandArgument = (text: string | undefined): string =>
  (text ?? '').trim().split(/\s+/).slice(1).join(' ');

const parseCsvRows = (content: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
};

export const parsePublicationQueriesCsv = (content: string): string[] => {
  const rows = parseCsvRows(content).filter((row) =>
    row.some((cell) => cell.trim()),
  );
  if (!rows.length) return [];

  const firstRow = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const headerIndex = firstRow.findIndex((cell) =>
    ['query', 'topic'].includes(cell),
  );
  const queryIndex = headerIndex >= 0 ? headerIndex : 0;
  const dataRows = headerIndex >= 0 ? rows.slice(1) : rows;
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const row of dataRows) {
    const rawQuery = row[queryIndex]?.trim();
    if (!rawQuery) continue;
    const query = publicationQuerySchema.parse(rawQuery);
    const normalized = query.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    queries.push(query);
  }

  return queries;
};
