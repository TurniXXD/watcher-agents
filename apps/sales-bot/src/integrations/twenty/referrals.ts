import type { TwentyRestClient } from './client.js';
import { filterAnd, filterEquals } from './deduplication.js';
import type { TwentyCurrencyValue, TwentyRecord } from './types.js';

export const createReferral = async (
  client: TwentyRestClient,
  input: {
    referrerId: string;
    referredCompanyId?: string;
    referredPersonId?: string;
    opportunityId?: string;
    commissionType: 'PERCENTAGE' | 'FIXED';
    commissionPercentage?: number;
    commissionAmount?: TwentyCurrencyValue;
  },
): Promise<TwentyRecord> => {
  const target =
    input.opportunityId ?? input.referredCompanyId ?? input.referredPersonId;
  if (!target) throw new Error('Referral requires a referred record');
  const existing = await client.find(
    'salesReferrals',
    filterAnd(
      filterEquals('referrerId', input.referrerId),
      filterEquals(
        input.opportunityId
          ? 'opportunityId'
          : input.referredCompanyId
            ? 'referredCompanyId'
            : 'referredPersonId',
        target,
      ),
    ),
  );
  if (existing) return existing;
  return client.create('salesReferrals', 'salesReferral', {
    name: `Referral:${input.referrerId}:${target}`,
    ...input,
    status: 'PENDING',
  });
};
