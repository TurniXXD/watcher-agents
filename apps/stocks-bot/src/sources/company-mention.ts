const normalize = (value: string): string =>
  ` ${value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

const corporateSuffixes = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'company',
  'co',
  'ltd',
  'limited',
  'plc',
]);

export const companyMention = (text: string, companyName: string): boolean => {
  const normalizedName = normalize(companyName).trim();
  if (!normalizedName) return false;
  const tokens = normalizedName.split(' ');
  while (tokens.length > 2 && corporateSuffixes.has(tokens.at(-1) ?? '')) {
    tokens.pop();
  }
  return normalize(text).includes(` ${tokens.join(' ')} `);
};
