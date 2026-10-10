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

    it('indexes confirmed sends by event time and preserves a replied stage', async () => {
      const campaign = await store!.createCampaign({
        name: `sales-report-test-${randomUUID()}`,
        offer: 'Test offer',
        subjectTemplate: 'Hello',
        bodyTemplate: 'Test',
        quicklyCampaignId: 987654,
      });
      try {
        const lead = await store!.discoverLead({
          campaignId: campaign.id,
          source: 'TEST',
          sourceExternalId: randomUUID(),
          companyName: 'Acme',
          websiteUrl: 'https://acme.example',
        });
        await store!.markAnalyzed(lead.id, {
          email: 'hello@acme.example',
          phone: '+420 777 123 456',
          phoneSourceUrl: 'https://acme.example/contact',
          emailSyntaxValid: true,
          audit: {},
          analysis: {},
          baseScore: 90,
          llmAdjustment: 0,
          finalScore: 90,
          draftSubject: 'Hello',
          draftBody: 'Test',
          minimumLeadScore: 70,
        });
        const matched = await store!.findLeadByQuicklyCampaignEmail(
          987654,
          'hello@acme.example',
        );
        expect(matched?.id).toBe(lead.id);
        const sentAt = new Date('2026-10-01T18:15:00Z');
        await store!.recordWebhook(
          randomUUID(),
          'email.sent',
          { event: 'email.sent' },
          sentAt,
          lead.id,
        );
        await store!.setLeadStage(lead.id, 'REPLIED');
        await store!.setLeadStage(lead.id, 'CONTACTED');
        await store!.markSynced(lead.id, 234567);
        const events = await store!.listSentEmailEvents(
          new Date('2026-10-01T00:00:00Z'),
          new Date('2026-10-02T00:00:00Z'),
        );
        const stored = events.find((item) => item.leadId === lead.id);
        expect(stored?.occurredAt).toEqual(sentAt);
        expect(stored?.lead?.stage).toBe('REPLIED');
        expect(stored?.lead?.phone).toBe('+420 777 123 456');
      } finally {
        await database!.salesCampaign.delete({ where: { id: campaign.id } });
      }
    });

    it('persists, deduplicates, claims, and disables periodic searches', async () => {
      const now = new Date('2026-10-10T08:00:00Z');
      const query = `Architects ${randomUUID()}`;
      const first = await store!.upsertSearchSubscription({
        telegramChatId: 123n,
        telegramUserId: 456n,
        query,
        locality: 'Brno',
        resultLimit: 10,
        intervalMinutes: 30,
        now,
      });
      try {
        const updated = await store!.upsertSearchSubscription({
          telegramChatId: 123n,
          telegramUserId: 456n,
          query: `  ${query.toUpperCase()}  `,
          locality: ' brno ',
          resultLimit: 20,
          intervalMinutes: 45,
          now,
        });
        expect(updated.id).toBe(first.id);
        expect(updated.resultLimit).toBe(20);

        await store!.completeSearchSubscription(first.id, ['known']);
        await expect(
          store!.unseenSearchResultKeys(first.id, ['known', 'new']),
        ).resolves.toEqual(new Set(['new']));

        const dueAt = new Date(now.getTime() + 46 * 60_000);
        await expect(
          store!.claimDueSearchSubscriptions(dueAt, 10),
        ).resolves.toContainEqual({ id: first.id });
        await expect(
          store!.claimDueSearchSubscriptions(dueAt, 10),
        ).resolves.not.toContainEqual({ id: first.id });

        await expect(
          store!.disableSearchSubscriptions(123n, first.id),
        ).resolves.toBe(1);
        await expect(
          store!.listSearchSubscriptions(123n),
        ).resolves.not.toContainEqual(
          expect.objectContaining({ id: first.id }),
        );
      } finally {
        await database!.salesSearchSubscription.delete({
          where: { id: first.id },
        });
      }
    });
  },
);
