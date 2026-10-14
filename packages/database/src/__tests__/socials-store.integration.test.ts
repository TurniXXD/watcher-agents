import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { SocialsStore } from '../socials-store.js';
import { SocialTrendStore } from '../social-trend-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const store = database ? new SocialsStore(database) : undefined;
const trendStore = database ? new SocialTrendStore(database) : undefined;

afterAll(async () => database?.$disconnect());

describe.skipIf(!database || !store)('SocialsStore with PostgreSQL', () => {
  it('persists relational planning, version history, and idempotent weeks', async () => {
    const ownerUserId = BigInt(`9${Date.now().toString().slice(-12)}`);
    const chatId = ownerUserId;
    const weekStart = new Date('2026-10-19T00:00:00.000Z');
    try {
      await store!.ensureSettings(ownerUserId, chatId);
      const project = await store!.createProject({
        ownerUserId,
        name: 'Integration project',
        visibility: 'PUBLIC',
      });
      const topic = (await store!.listTopics(ownerUserId))[0]!;
      const idea = await store!.createIdea({
        ownerUserId,
        title: 'Ověřená automatizace CRM',
        description: 'Poznámka ze skutečného projektu.',
        topicIds: [topic.id],
        projectIds: [project.id],
      });
      const input = {
        ownerUserId,
        weekStart,
        weekEnd: new Date('2026-10-25T23:59:59.000Z'),
        items: [
          {
            ideaId: idea.id,
            title: idea.title,
            channel: 'LINKEDIN' as const,
            format: 'TEXT_POST' as const,
            contentPillar: topic.pillar,
            targetAudience: 'české firmy',
            objective: 'QUALIFIED_LEADS' as const,
            angle: 'praktický postup',
            planningReason: 'Navazuje na skutečný projekt.',
            plannedAt: new Date('2026-10-19T07:00:00.000Z'),
            estimatedPreparationMinutes: 45,
            topicIds: [topic.id],
            projectIds: [project.id],
          },
        ],
      };
      const first = await store!.createWeeklyPlan(input);
      const second = await store!.createWeeklyPlan(input);
      expect(second.id).toBe(first.id);
      expect(first.contentItems).toHaveLength(1);
      expect(first.checklistItems.length).toBeGreaterThanOrEqual(4);

      const item = first.contentItems[0]!;
      const edited = await store!.updateDraftContentItem(ownerUserId, item.id, {
        title: 'Upravená automatizace CRM',
        angle: 'nový ověřený úhel',
      });
      expect(edited.angle).toBe('nový ověřený úhel');
      await store!.saveContentVersion({
        ownerUserId,
        contentItemId: item.id,
        content: 'První ručně importovaný draft.',
        source: 'IMPORTED',
        status: 'DRAFT',
      });
      await store!.saveContentVersion({
        ownerUserId,
        contentItemId: item.id,
        content: 'Druhá ručně importovaná verze.',
        source: 'IMPORTED',
        status: 'READY',
      });
      const history = await store!.contentHistory(ownerUserId, item.id);
      expect(
        history?.versions.map(({ versionNumber }) => versionNumber),
      ).toEqual([2, 1]);
      expect(history?.projects[0]?.project.id).toBe(project.id);
      expect(history?.topics[0]?.topic.id).toBe(topic.id);

      await store!.approveWeeklyPlan(ownerUserId, first.id);
      await expect(
        store!.updateDraftContentItem(ownerUserId, item.id, {
          title: 'Nepovolená změna',
          angle: 'po schválení',
        }),
      ).rejects.toThrow('Draft plan item not found');
      await expect(
        store!.removeDraftContentItem(ownerUserId, item.id),
      ).rejects.toThrow('Draft plan item not found');
      await expect(
        store!.updateContentPrompt(ownerUserId, item.id, 'Nepovolený prompt'),
      ).rejects.toThrow('Draft plan item not found');
    } finally {
      await database!.socialSettings.deleteMany({ where: { ownerUserId } });
      await database!.socialWeeklyPlan.deleteMany({ where: { ownerUserId } });
      await database!.socialContentItem.deleteMany({ where: { ownerUserId } });
      await database!.socialContentIdea.deleteMany({ where: { ownerUserId } });
      await database!.socialProject.deleteMany({ where: { ownerUserId } });
      await database!.socialTopic.deleteMany({ where: { ownerUserId } });
    }
  });
});

describe.skipIf(!database || !trendStore)(
  'SocialTrendStore with PostgreSQL',
  () => {
    it('persists idempotent runs, provenance, opportunities, and feedback', async () => {
      const ownerUserId = BigInt(`8${Date.now().toString().slice(-12)}`);
      const now = new Date('2026-10-14T05:00:00.000Z');
      try {
        await trendStore!.ensureProfile(ownerUserId, now);
        const firstClaim = await trendStore!.startRun({
          ownerUserId,
          chatId: ownerUserId,
          idempotencyKey: `integration-${ownerUserId}`,
          trigger: 'MANUAL',
          requestedSources: ['MANUAL'],
        });
        const repeatedClaim = await trendStore!.startRun({
          ownerUserId,
          chatId: ownerUserId,
          idempotencyKey: `integration-${ownerUserId}`,
          trigger: 'MANUAL',
          requestedSources: ['MANUAL'],
        });
        expect(firstClaim.claimed).toBe(true);
        expect(repeatedClaim.claimed).toBe(false);
        expect(repeatedClaim.run.id).toBe(firstClaim.run.id);
        const signal = await trendStore!.upsertSignal(ownerUserId, {
          source: 'MANUAL',
          externalId: 'integration-signal',
          fingerprint: `integration-fingerprint-${ownerUserId}`,
          sourceUrl: 'https://example.com/trend',
          title: 'AI workflow automation',
          region: 'US',
          collectedAt: now,
          metrics: { views: 100 },
        });
        const cluster = await trendStore!.upsertCluster({
          ownerUserId,
          canonicalKey: `integration-cluster-${ownerUserId}`,
          title: 'AI workflow automation',
          keywords: ['workflow', 'automation'],
          stage: 'UNKNOWN',
          signalIds: [signal.id],
          now,
        });
        const opportunity = await trendStore!.upsertOpportunity({
          ownerUserId,
          runId: firstClaim.run.id,
          clusterId: cluster.id,
          fingerprint: `integration-opportunity-${ownerUserId}`,
          title: 'AI workflow pro české firmy',
          description: 'Praktický a ověřitelný experiment.',
          czechMarketStatus: 'UNCERTAIN',
          opportunityScore: 70,
          confidence: 35,
          factors: {
            usMomentum: 50,
            czechOpportunity: 50,
            audienceRelevance: 80,
            businessPotential: 80,
            contentFeasibility: 70,
            evidenceQuality: 30,
          },
          missingData: ['Czech evidence'],
          explanation: 'Confidence is lower than opportunity.',
          evidence: { references: ['https://example.com/trend'] },
          contentConcept: { title: 'Concept' },
          recommendedChannel: 'LINKEDIN',
          recommendedFormat: 'TEXT_POST',
          objective: 'CREDIBILITY',
          estimatedEffortMinutes: 45,
        });
        await trendStore!.addFeedback({
          ownerUserId,
          opportunityId: opportunity.id,
          kind: 'RELEVANT',
        });
        const detail = await trendStore!.opportunity(
          ownerUserId,
          opportunity.id,
        );
        expect(detail?.cluster.signals[0]?.id).toBe(signal.id);
        expect(detail?.feedback[0]?.kind).toBe('RELEVANT');
      } finally {
        await database!.socialTrendProfile.deleteMany({
          where: { ownerUserId },
        });
        await database!.socialTrendResearchRun.deleteMany({
          where: { ownerUserId },
        });
        await database!.socialTrendCluster.deleteMany({
          where: { ownerUserId },
        });
        await database!.socialTrendSignal.deleteMany({
          where: { ownerUserId },
        });
      }
    });
  },
);
