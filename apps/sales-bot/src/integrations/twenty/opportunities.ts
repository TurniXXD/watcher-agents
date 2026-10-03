import type { TwentyRestClient } from './client.js';
import { filterAnd, filterEquals } from './deduplication.js';
import type { TwentyOpportunityInput, TwentyRecord } from './types.js';

export const createOpportunity = async (
  client: TwentyRestClient,
  input: TwentyOpportunityInput,
  useAppFields: boolean,
): Promise<TwentyRecord> => {
  const existing = await client.find(
    'opportunities',
    filterAnd(
      filterEquals('name', input.name),
      filterEquals('companyId', input.companyId),
    ),
  );
  if (existing) return existing;
  return client.create('opportunities', 'opportunity', {
    name: input.name,
    companyId: input.companyId,
    ...(useAppFields
      ? {
          businessType: input.businessType,
          leadSource: input.source,
          ...(input.nextAction ? { nextAction: input.nextAction } : {}),
          ...(input.qualification
            ? {
                qualification: {
                  markdown: input.qualification,
                  blocknote: '',
                },
              }
            : {}),
        }
      : {}),
  });
};
