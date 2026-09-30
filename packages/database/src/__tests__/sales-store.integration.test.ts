import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { SalesStore } from '../sales-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const store = database ? new SalesStore(database) : undefined;

describe.skipIf(!database || !store)(
  'SalesStore authorization evidence',
  () => {
    afterAll(async () => {
      await database?.$disconnect();
    });

    it('keeps a revocation audit trail and rejects stale reactivation', async () => {
      const campaign = await store!.createCampaign({
        name: `sales-evidence-test-${randomUUID()}`,
        offer: 'Test offer',
        subjectTemplate: 'Hello',
        bodyTemplate: 'Test',
      });
      const email = `test-${randomUUID()}@example.com`;
      const input = {
        campaignId: campaign.id,
        email,
        basis: 'RECIPIENT_OPT_IN' as const,
        evidenceSource: 'test-form',
        evidenceReference: `submission-${randomUUID()}`,
        capturedAt: new Date('2026-09-01T00:00:00Z'),
      };
      try {
        await store!.recordAuthorization(input);
        await store!.revokeAuthorization(campaign.id, email);
        await expect(store!.recordAuthorization(input)).rejects.toThrow(
          'Renewal requires evidence',
        );
        const current = await store!.getAuthorization(campaign.id, email);
        expect(current?.revokedAt).not.toBeNull();
        const events = await store!.listAuthorizationEvents(campaign.id, email);
        expect(events.map((event) => event.action)).toEqual([
          'RECORDED',
          'REVOKED',
        ]);
      } finally {
        await database!.salesCampaign.delete({ where: { id: campaign.id } });
      }
    });
  },
);
