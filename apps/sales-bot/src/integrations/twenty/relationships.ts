import type { TwentyRestClient } from './client.js';
import { filterAnd, filterEquals } from './deduplication.js';
import type { TwentyRecord } from './types.js';

export const createRelationship = async (
  client: TwentyRestClient,
  input: {
    fromPersonId: string;
    toPersonId: string;
    type:
      | 'KNOWS'
      | 'FRIEND'
      | 'COLLEAGUE'
      | 'BUSINESS_PARTNER'
      | 'CLIENT'
      | 'SUPPLIER'
      | 'CONTRACTOR'
      | 'REFERRED'
      | 'INTRODUCED'
      | 'OTHER';
    strength?: number;
    source?: string;
    notes?: string;
  },
): Promise<TwentyRecord> => {
  const existing = await client.find(
    'salesRelationships',
    filterAnd(
      filterEquals('fromPersonId', input.fromPersonId),
      filterEquals('toPersonId', input.toPersonId),
      filterEquals('type', input.type),
    ),
  );
  if (existing) return existing;
  return client.create('salesRelationships', 'salesRelationship', {
    name: `${input.type}:${input.fromPersonId}:${input.toPersonId}`,
    fromPersonId: input.fromPersonId,
    toPersonId: input.toPersonId,
    type: input.type,
    ...(input.strength !== undefined ? { strength: input.strength } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.notes ? { notes: { markdown: input.notes, blocknote: '' } } : {}),
  });
};
