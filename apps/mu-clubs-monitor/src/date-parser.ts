const months: Record<string, number> = {
  leden: 0,
  ledna: 0,
  unor: 1,
  unora: 1,
  únor: 1,
  února: 1,
  brezen: 2,
  brezna: 2,
  březen: 2,
  března: 2,
  duben: 3,
  dubna: 3,
  kveten: 4,
  kvetna: 4,
  květen: 4,
  května: 4,
  cerven: 5,
  cervna: 5,
  červen: 5,
  června: 5,
  cervenec: 6,
  cervence: 6,
  červenec: 6,
  července: 6,
  srpen: 7,
  srpna: 7,
  zari: 8,
  září: 8,
  rijen: 9,
  rijna: 9,
  říjen: 9,
  října: 9,
  listopad: 10,
  listopadu: 10,
  prosinec: 11,
  prosince: 11,
};

const pragueDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date => {
  const candidate = new Date(Date.UTC(year, month, day, hour - 2, minute));
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    timeZoneName: 'shortOffset',
  });
  const offset = formatter
    .formatToParts(candidate)
    .find(({ type }) => type === 'timeZoneName')
    ?.value.match(/[+-]\d+/u)?.[0];
  return new Date(
    Date.UTC(year, month, day, hour - Number(offset ?? 1), minute),
  );
};

export const parseCzechDate = (
  input: string,
  now = new Date(),
): Date | undefined => {
  const normalized = input.toLowerCase().replace(/\s+/gu, ' ');
  const numeric = normalized.match(
    /\b(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?(?:\s+(?:v\s*)?(\d{1,2})(?::|\.)(\d{2}))?/u,
  );
  const named = normalized.match(
    /\b(\d{1,2})\.\s*([a-zá-ž]+)(?:\s+(\d{4}))?(?:\s+(?:v\s*)?(\d{1,2})(?::|\.)(\d{2}))?/u,
  );
  const day = Number(numeric?.[1] ?? named?.[1]);
  const month = numeric
    ? Number(numeric[2]) - 1
    : named
      ? months[named[2]!]
      : undefined;
  if (!day || month === undefined || month < 0 || month > 11) return undefined;
  let year = Number(numeric?.[3] ?? named?.[3] ?? now.getUTCFullYear());
  const hour = Number(numeric?.[4] ?? named?.[4] ?? 12);
  const minute = Number(numeric?.[5] ?? named?.[5] ?? 0);
  let parsed = pragueDate(year, month, day, hour, minute);
  if (
    !numeric?.[3] &&
    !named?.[3] &&
    parsed.getTime() < now.getTime() - 30 * 86_400_000
  ) {
    year += 1;
    parsed = pragueDate(year, month, day, hour, minute);
  }
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
