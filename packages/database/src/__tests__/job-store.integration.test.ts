import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { CandidateProfile, NormalizedJob } from '@watcher/jobs';
import { createDatabaseClient } from '../client.js';
import { JobStore } from '../job-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const store = database ? new JobStore(database) : undefined;

const profile: CandidateProfile = {
  name: 'Integration test candidate',
  professionalTitle: 'Full-Stack Developer',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school',
  languages: { Czech: 'native', English: 'B2' },
  preferredRoles: ['Full-Stack Developer'],
  avoidedRoles: ['Recruiter'],
  requiredTechnologies: [],
  excludedTechnologies: [],
  adjacentRoles: [],
  preferredLocations: {
    countries: ['Czechia'],
    regions: ['Europe'],
    cities: ['Brno'],
    remote: true,
    hybrid: true,
    onsite: true,
  },
  skills: [{ name: 'TypeScript', proficiency: 'EXPERT', years: 5 }],
  experience: [],
  weights: {
    technology: 30,
    experience: 20,
    role: 15,
    location: 15,
    language: 10,
    career: 5,
    conditions: 5,
  },
  thresholds: { excellent: 85, strong: 70, possible: 55, notify: 70 },
};

describe.skipIf(!database || !store)('JobStore idempotency', () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it('deduplicates across sources and reserves each notification once', async () => {
    const suffix = randomUUID();
    const sourceIds = [`job-test-a-${suffix}`, `job-test-b-${suffix}`];
    await store!.syncSources(
      sourceIds.map((id) => ({
        id,
        name: id,
        baseUrl: `https://${id}.example`,
        strategy: 'RSS',
        enabledByDefault: true,
      })),
    );
    const makeJob = (sourceId: string, externalId: string): NormalizedJob => ({
      sourceId,
      externalId,
      title: `TypeScript Engineer ${suffix}`,
      company: `Example ${suffix}`,
      description: 'Build TypeScript applications with PostgreSQL.',
      location: 'Brno, Czechia',
      country: 'Czechia',
      city: 'Brno',
      workMode: 'HYBRID',
      remoteRegions: ['Europe'],
      technologyStack: ['TypeScript', 'PostgreSQL'],
      originalUrl: `https://${sourceId}.example/jobs/${externalId}`,
      canonicalApplicationUrl: `https://${sourceId}.example/jobs/${externalId}`,
      raw: { sourceId, externalId },
    });

    let jobId: string | undefined;
    try {
      const firstJob = makeJob(sourceIds[0]!, 'one');
      const first = await store!.upsertJob(firstJob);
      const duplicate = await store!.upsertJob(makeJob(sourceIds[1]!, 'two'));
      const repeatedUrl = await store!.upsertJob({
        ...makeJob(sourceIds[0]!, 'three'),
        originalUrl: firstJob.originalUrl,
        canonicalApplicationUrl: firstJob.canonicalApplicationUrl,
      });
      jobId = first.job.id;
      expect(duplicate.job.id).toBe(first.job.id);
      expect(repeatedUrl.job.id).toBe(first.job.id);
      expect(first.isNew).toBe(true);
      expect(duplicate.isNew).toBe(false);
      expect(repeatedUrl.isNew).toBe(false);
      await expect(
        database!.jobSourceReference.count({
          where: { jobId, sourceUrl: firstJob.originalUrl },
        }),
      ).resolves.toBe(1);
      await expect(
        database!.jobRawJob.findUnique({
          where: {
            sourceId_externalId: {
              sourceId: sourceIds[0]!,
              externalId: 'three',
            },
          },
        }),
      ).resolves.toMatchObject({ jobId });

      const active = await store!.ensureProfile(profile);
      const evaluation = await store!.saveEvaluation({
        jobId,
        profileId: active.row.id,
        profileVersion: active.row.version,
        jobContentHash: first.contentHash,
        result: {
          score: 90,
          eligibility: 'ELIGIBLE',
          recommendation: 'EXCELLENT',
          matchingSkills: ['TypeScript'],
          missingSkills: [],
          hardBlockers: [],
          uncertainties: [],
          reasoning: 'Strong match.',
          scoreBreakdown: { technology: 30 },
        },
      });
      const key = `${jobId}:initial-digest`;
      const reserved = await store!.reserveNotification({
        jobId,
        evaluationId: evaluation.id,
        key,
        baseline: false,
      });
      const repeated = await store!.reserveNotification({
        jobId,
        evaluationId: evaluation.id,
        key,
        baseline: false,
      });
      expect(reserved.reserved).toBe(true);
      expect(repeated.reserved).toBe(false);
      expect(repeated.row.id).toBe(reserved.row.id);

      await store!.recordNotificationDelivery({
        notificationId: reserved.row.id,
        provider: 'telegram',
        recipient: '123',
        sent: false,
        error: 'temporary',
      });
      await store!.recordNotificationDelivery({
        notificationId: reserved.row.id,
        provider: 'telegram',
        recipient: '123',
        sent: true,
      });
      const delivery = await database!.jobNotificationDelivery.findUnique({
        where: {
          notificationId_provider_recipient: {
            notificationId: reserved.row.id,
            provider: 'telegram',
            recipient: '123',
          },
        },
      });
      expect(delivery).toMatchObject({ status: 'SENT', attempts: 2 });
    } finally {
      if (jobId) await database!.job.delete({ where: { id: jobId } });
      await database!.jobSource.deleteMany({
        where: { id: { in: sourceIds } },
      });
    }
  });
});
