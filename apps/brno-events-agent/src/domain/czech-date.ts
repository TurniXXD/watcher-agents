const months: Record<string, number> = {
  leden: 0,
  ledna: 0,
  únor: 1,
  února: 1,
  brezen: 2,
  brezna: 2,
  duben: 3,
  dubna: 3,
  kveten: 4,
  kvetna: 4,
  cerven: 5,
  cervna: 5,
  cervenec: 6,
  cervence: 6,
  srpen: 7,
  srpna: 7,
  zari: 8,
  rijen: 9,
  rijna: 9,
  listopad: 10,
  listopadu: 10,
  prosinec: 11,
  prosince: 11,
};
const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();

export const parseCzechDate = (
  value: string,
  now = new Date(),
): Date | undefined => {
  const text = fold(value.trim());
  const relative = text.match(/^(dnes|zitra)(?:\s+(\d{1,2}):(\d{2}))?$/u);
  if (relative) {
    const date = new Date(now);
    if (relative[1] === 'zitra') date.setDate(date.getDate() + 1);
    date.setHours(Number(relative[2] ?? 0), Number(relative[3] ?? 0), 0, 0);
    return date;
  }
  const numeric = text.match(
    /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/u,
  );
  if (numeric)
    return new Date(
      Number(numeric[3]),
      Number(numeric[2]) - 1,
      Number(numeric[1]),
      Number(numeric[4] ?? 0),
      Number(numeric[5] ?? 0),
    );
  const named = text.match(
    /^(\d{1,2})\.\s*([a-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/u,
  );
  if (named && months[named[2]!] !== undefined)
    return new Date(
      Number(named[3]),
      months[named[2]!]!,
      Number(named[1]),
      Number(named[4] ?? 0),
      Number(named[5] ?? 0),
    );
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
};

export const parseCzechDateRange = (
  value: string,
): { start: Date; end?: Date } | undefined => {
  const text = fold(value.trim()).replace(/[–—]/gu, '-');
  const range = text.match(
    /^(\d{1,2})\.\s*-\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/u,
  );
  if (range) {
    return {
      start: new Date(Number(range[4]), Number(range[3]) - 1, Number(range[1])),
      end: new Date(
        Number(range[4]),
        Number(range[3]) - 1,
        Number(range[2]),
        23,
        59,
        59,
        999,
      ),
    };
  }
  const single = parseCzechDate(value);
  return single ? { start: single } : undefined;
};
