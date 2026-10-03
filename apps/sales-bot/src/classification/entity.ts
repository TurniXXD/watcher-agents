export type NormalizedEntityType = 'COMPANY' | 'PERSON';

const personTypes = new Set([
  'person',
  'individual',
  'contact',
  'freelancer',
  'sole_trader',
]);

export const normalizeEntityType = (
  value: string | undefined,
): NormalizedEntityType =>
  value && personTypes.has(value.trim().toLowerCase().replaceAll(/\s+/gu, '_'))
    ? 'PERSON'
    : 'COMPANY';
