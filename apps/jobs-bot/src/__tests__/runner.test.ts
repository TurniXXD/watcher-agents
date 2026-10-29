import { describe, expect, it, vi } from 'vitest';
import {
  jobContentHash,
  type CandidateProfile,
  type JobSourceDefinition,
} from '@watcher/jobs';
import { JobDiscoveryRunner } from '../runner.js';

const profile: CandidateProfile = {
  name: 'Candidate',
  professionalTitle: 'Full-Stack Developer',
  yearsExperience: 5,
  evaluationMode: 'TECHNICAL',
  searchCategories: { salesBusinessDevelopment: false },
  educationLevel: 'Secondary technical school',
  languages: { Czech: 'native', English: 'B2' },
  preferredRoles: ['Full-Stack Developer'],
  avoidedRoles: [],
  requiredTechnologies: [],
  excludedTechnologies: [],
  adjacentRoles: [],
  preferredContractTypes: ['IČO', 'B2B'],
  preferredLocations: {
    countries: ['Czechia'],
    regions: ['Europe'],
    cities: ['Brno'],
    remote: true,
    hybrid: true,
    onsite: true,
  },
  skills: [{ name: 'TypeScript', proficiency: 'EXPERT' }],
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

const source = (
  id: string,
  discover: NonNullable<JobSourceDefinition['adapter']>['discover'],
): JobSourceDefinition => ({
  id,
  name: id,
  baseUrl: `https://${id}.example`,
  strategy: 'API',
  enabledByDefault: true,
  adapter: {
    id,
    name: id,
    baseUrl: `https://${id}.example`,
    strategy: 'API',
    attribution: 'Test fixture',
    fetchIntervalMinutes: 60,
    rateLimitPerMinute: 30,
    discover,
  },
});

const createStore = (sourceIds: string[]) => ({
  startRun: vi.fn(async () => ({ id: 'run-1', baseline: false })),
  listSources: vi.fn(async () =>
    sourceIds.map((id) => ({ id, enabled: true })),
  ),
  getCheckpoint: vi.fn(async () => null),
  saveCheckpoint: vi.fn(async () => undefined),
  getActiveProfile: vi.fn(async () => ({
    row: { id: 'profile-1', version: 1 },
    profile,
  })),
  recordSourceSuccess: vi.fn(async () => undefined),
  recordSourceDegraded: vi.fn(async () => undefined),
  recordSourceFailure: vi.fn(async () => undefined),
  finishRun: vi.fn(async () => undefined),
  listJobs: vi.fn(async () => []),
  updateAvailability: vi.fn(async () => undefined),
});

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('JobDiscoveryRunner orchestration', () => {
  it('prevents overlapping runs', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = source('slow', async () => {
      await waiting;
      return { jobs: [] };
    });
    const store = createStore(['slow']);
    const runner = new JobDiscoveryRunner(store as never, profile, 72, logger, [
      adapter,
    ]);

    const first = runner.run({ trigger: 'MANUAL' });
    await vi.waitFor(() => expect(adapter.adapter?.discover).toBeDefined());
    const overlapping = await runner.run({ trigger: 'SCHEDULED' });
    expect(overlapping).toMatchObject({
      runId: 'overlap-prevented',
      status: 'SKIPPED',
    });
    release?.();
    await expect(first).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(store.startRun).toHaveBeenCalledTimes(1);
  });

  it('isolates one failed source and returns a partial result', async () => {
    const definitions = [
      source('healthy', async () => ({ jobs: [] })),
      source('failed', async () => {
        throw new Error('fixture failure');
      }),
    ];
    const store = createStore(['healthy', 'failed']);
    const runner = new JobDiscoveryRunner(
      store as never,
      profile,
      72,
      logger,
      definitions,
    );

    await expect(runner.run({ trigger: 'MANUAL' })).resolves.toMatchObject({
      status: 'PARTIAL',
      sourceFailures: 1,
    });
    expect(store.recordSourceSuccess).toHaveBeenCalledWith('healthy', 0);
    expect(store.recordSourceFailure).toHaveBeenCalledWith(
      'failed',
      'run-1',
      expect.any(Error),
      true,
    );
  });

  it('keeps dry runs read-only while reporting discovered listings', async () => {
    const definition = source('preview', async () => ({
      jobs: [
        {
          sourceId: 'preview',
          externalId: 'job-1',
          title: 'TypeScript Developer',
          company: 'Example',
          description: 'Build TypeScript applications.',
          workMode: 'UNKNOWN' as const,
          remoteRegions: [],
          technologyStack: ['TypeScript'],
          originalUrl: 'https://preview.example/jobs/job-1',
          raw: {},
        },
      ],
      checkpoint: { etag: 'preview-etag' },
    }));
    const store = {
      ...createStore(['preview']),
      findRawJob: vi.fn(async () => null),
      upsertJob: vi.fn(),
      findEvaluation: vi.fn(),
      saveEvaluation: vi.fn(),
      reserveNotification: vi.fn(),
    };
    const runner = new JobDiscoveryRunner(store as never, profile, 72, logger, [
      definition,
    ]);

    await expect(
      runner.run({ trigger: 'MANUAL', dryRun: true }),
    ).resolves.toMatchObject({
      runId: 'dry-run',
      status: 'SUCCESS',
      discovered: 1,
      created: 0,
      evaluated: 0,
      alerts: [],
    });
    expect(store.startRun).not.toHaveBeenCalled();
    expect(store.saveCheckpoint).not.toHaveBeenCalled();
    expect(store.recordSourceSuccess).not.toHaveBeenCalled();
    expect(store.recordSourceFailure).not.toHaveBeenCalled();
    expect(store.finishRun).not.toHaveBeenCalled();
    expect(store.upsertJob).not.toHaveBeenCalled();
  });

  it('persists a baseline match without emitting startup alerts', async () => {
    const job = {
      sourceId: 'baseline',
      externalId: 'job-1',
      title: 'Full-Stack TypeScript Developer',
      company: 'Example',
      description:
        'Build React and Node.js applications with TypeScript in Brno. Five years experience. English B2.',
      location: 'Brno, Czechia',
      country: 'Czechia',
      city: 'Brno',
      workMode: 'REMOTE' as const,
      remoteRegions: ['Europe'],
      contractType: 'B2B contractor',
      technologyStack: ['React', 'Node.js', 'TypeScript'],
      originalUrl: 'https://baseline.example/jobs/job-1',
      raw: {},
    };
    const definition = source('baseline', async () => ({ jobs: [job] }));
    const store = {
      ...createStore(['baseline']),
      startRun: vi.fn(async () => ({ id: 'run-1', baseline: true })),
      findRawJob: vi.fn(async () => null),
      upsertJob: vi.fn(async () => ({
        job: { id: 'job-1' },
        isNew: true,
        changed: true,
        contentHash: 'content-hash',
      })),
      findEvaluation: vi.fn(async () => null),
      saveEvaluation: vi.fn(async () => ({ id: 'evaluation-1' })),
      reserveNotification: vi.fn(async () => ({
        row: { id: 'notification-1', status: 'SKIPPED' },
        reserved: true,
      })),
    };
    const runner = new JobDiscoveryRunner(store as never, profile, 72, logger, [
      definition,
    ]);

    const result = await runner.run({ trigger: 'SCHEDULED' });

    expect(result).toMatchObject({ baseline: true, alerts: [] });
    expect(store.reserveNotification).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: true }),
    );
  });

  it('honors a persistent run claim held by another process', async () => {
    const store = {
      ...createStore(['healthy']),
      startRun: vi.fn(async () => ({
        id: 'existing-run',
        baseline: false,
        claimed: false,
      })),
    };
    const discover = vi.fn(async () => ({ jobs: [] }));
    const definition = source('healthy', discover);
    const runner = new JobDiscoveryRunner(store as never, profile, 72, logger, [
      definition,
    ]);

    await expect(runner.run({ trigger: 'SCHEDULED' })).resolves.toMatchObject({
      runId: 'existing-run',
      status: 'SKIPPED',
    });
    expect(discover).not.toHaveBeenCalled();
    expect(store.finishRun).not.toHaveBeenCalled();
  });

  it('does not refetch or replace unchanged fresh detail content', async () => {
    const listing = {
      sourceId: 'two-stage',
      externalId: 'job-1',
      title: 'Full-Stack Developer',
      company: 'Example',
      description: 'Short listing copy.',
      shortDescription: 'Short listing copy.',
      location: 'Europe',
      workMode: 'REMOTE' as const,
      remoteRegions: ['Europe'],
      technologyStack: ['TypeScript'],
      originalUrl: 'https://two-stage.example/jobs/job-1',
      raw: { listing: true },
    };
    const detail = vi.fn(async () => ({
      ...listing,
      description: 'Full job detail that must remain stored.',
    }));
    const definition = source('two-stage', async () => ({ jobs: [listing] }));
    definition.adapter!.fetchDetail = detail;
    const listingHash = jobContentHash({
      title: listing.title,
      company: listing.company,
      description: listing.shortDescription,
      location: listing.location,
    });
    const store = {
      ...createStore(['two-stage']),
      findRawJob: vi.fn(async () => ({
        listingHash,
        lastDetailFetchedAt: new Date(),
      })),
      upsertJob: vi.fn(async () => ({
        job: { id: 'job-1' },
        isNew: false,
        changed: false,
        contentHash: 'stored-full-detail-hash',
      })),
      findEvaluation: vi.fn(async () => ({
        profileVersion: 1,
        jobContentHash: 'stored-full-detail-hash',
      })),
      saveEvaluation: vi.fn(),
      reserveNotification: vi.fn(),
    };
    const runner = new JobDiscoveryRunner(store as never, profile, 72, logger, [
      definition,
    ]);

    await runner.run({ trigger: 'MANUAL' });

    expect(detail).not.toHaveBeenCalled();
    expect(store.upsertJob).toHaveBeenCalledWith(
      listing,
      expect.any(Date),
      expect.objectContaining({ listing, detailFetched: false }),
    );
    expect(store.saveEvaluation).not.toHaveBeenCalled();
  });

  it('checks the exact apply link and suppresses an expired new match', async () => {
    const job = {
      sourceId: 'expiry-check',
      externalId: 'job-1',
      title: 'Full-Stack Developer',
      company: 'Example',
      description: 'Build TypeScript products in Brno.',
      location: 'Brno, Czechia',
      workMode: 'HYBRID' as const,
      remoteRegions: ['Europe'],
      technologyStack: ['TypeScript'],
      originalUrl: 'https://apply.example/jobs/job-1',
      canonicalApplicationUrl: 'https://apply.example/jobs/job-1',
      raw: {},
    };
    const store = {
      ...createStore(['expiry-check']),
      findRawJob: vi.fn(async () => null),
      upsertJob: vi.fn(async () => ({
        job: {
          id: 'job-1',
          availabilityStatus: 'LISTED_UNVERIFIED',
          lastAvailabilityCheckAt: null,
        },
        isNew: true,
        changed: true,
        contentHash: 'content-hash',
      })),
      findEvaluation: vi.fn(async () => null),
      saveEvaluation: vi.fn(async () => ({ id: 'evaluation-1' })),
      reserveNotification: vi.fn(),
    };
    const availabilityVerifier = vi.fn(async () => 'CLOSED_CONFIRMED' as const);
    const runner = new JobDiscoveryRunner(
      store as never,
      profile,
      72,
      logger,
      [source('expiry-check', async () => ({ jobs: [job] }))],
      undefined,
      undefined,
      availabilityVerifier,
    );

    const result = await runner.run({ trigger: 'SCHEDULED' });

    expect(availabilityVerifier).toHaveBeenCalledWith(job.originalUrl);
    expect(store.updateAvailability).toHaveBeenCalledWith(
      'job-1',
      'CLOSED_CONFIRMED',
    );
    expect(store.reserveNotification).not.toHaveBeenCalled();
    expect(result.alerts).toEqual([]);
  });

  it('periodically rechecks a stale application link for a stored match', async () => {
    const store = {
      ...createStore(['stored-expiry-check']),
      listJobs: vi.fn(async () => [
        {
          id: 'stored-job-1',
          originalUrl: 'https://listing.example/jobs/stored-job-1',
          canonicalApplicationUrl: 'https://apply.example/jobs/stored-job-1',
          availabilityStatus: 'LISTED_UNVERIFIED',
          lastAvailabilityCheckAt: new Date('2026-10-01T00:00:00.000Z'),
          evaluations: [{ eligibility: 'ELIGIBLE' }],
        },
      ]),
    };
    const availabilityVerifier = vi.fn(async () =>
      Promise.resolve('CLOSED_CONFIRMED' as const),
    );
    const runner = new JobDiscoveryRunner(
      store as never,
      profile,
      72,
      logger,
      [source('stored-expiry-check', async () => ({ jobs: [] }))],
      undefined,
      undefined,
      availabilityVerifier,
    );

    await runner.run({ trigger: 'SCHEDULED' });

    expect(availabilityVerifier).toHaveBeenCalledWith(
      'https://apply.example/jobs/stored-job-1',
    );
    expect(store.updateAvailability).toHaveBeenCalledWith(
      'stored-job-1',
      'CLOSED_CONFIRMED',
    );
  });

  it('marks a source degraded and logs detail failures while retaining listing data', async () => {
    const listing = {
      sourceId: 'detail-source',
      externalId: 'job-1',
      title: 'Full-Stack Developer',
      company: 'Example',
      description: 'Short listing copy.',
      location: 'Brno, Czechia',
      workMode: 'ONSITE' as const,
      remoteRegions: [],
      technologyStack: ['TypeScript'],
      originalUrl: 'https://detail-source.example/jobs/1',
      raw: {},
    };
    const definition = source('detail-source', async () => ({
      jobs: [listing],
    }));
    definition.adapter!.fetchDetail = vi.fn(async () => {
      throw new Error('HTTP 403 from detail source');
    });
    const store = {
      ...createStore(['detail-source']),
      findRawJob: vi.fn(async () => null),
      upsertJob: vi.fn(async () => ({
        job: { id: 'job-1' },
        isNew: false,
        contentHash: 'content-hash',
      })),
      findEvaluation: vi.fn(async () => ({
        profileVersion: 1,
        jobContentHash: 'content-hash',
      })),
    };
    const runner = new JobDiscoveryRunner(store as never, profile, 72, logger, [
      definition,
    ]);
    await runner.run({ trigger: 'MANUAL' });
    expect(store.recordSourceDegraded).toHaveBeenCalledWith(
      'detail-source',
      1,
      1,
    );
    expect(store.recordSourceSuccess).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'detail-source',
        discovered: 1,
        detailFailures: 1,
      }),
      'Job source completed with detail failures',
    );
  });

  it('does not automatically request a LinkedIn application page', async () => {
    const store = {
      ...createStore(['linkedin']),
      listJobs: vi.fn(async () => [
        {
          id: 'linkedin-job',
          originalUrl: 'https://www.linkedin.com/jobs/view/123/',
          canonicalApplicationUrl: null,
          availabilityStatus: 'LISTED_UNVERIFIED',
          lastAvailabilityCheckAt: null,
          evaluations: [{ eligibility: 'UNCERTAIN' }],
        },
      ]),
    };
    const availabilityVerifier = vi.fn(async () => 'OPEN_CONFIRMED' as const);
    const runner = new JobDiscoveryRunner(
      store as never,
      profile,
      72,
      logger,
      [source('linkedin', async () => ({ jobs: [] }))],
      undefined,
      undefined,
      availabilityVerifier,
    );
    await runner.run({ trigger: 'SCHEDULED' });
    expect(availabilityVerifier).not.toHaveBeenCalled();
    expect(store.updateAvailability).toHaveBeenCalledWith(
      'linkedin-job',
      'LISTED_UNVERIFIED',
    );
  });

  it('routes sales roles through the separate career-transition evaluation profile', async () => {
    const salesProfile: CandidateProfile = {
      ...profile,
      searchCategories: { salesBusinessDevelopment: true },
    };
    const salesJob = {
      sourceId: 'sales-source',
      externalId: 'sales-1',
      title: 'Business Development Representative',
      company: 'Example SaaS',
      description:
        'Entry-level B2B SaaS position. No previous sales experience required. Structured onboarding and fixed salary.',
      location: 'Brno, Czechia',
      country: 'Czechia',
      city: 'Brno',
      workMode: 'ONSITE' as const,
      remoteRegions: [],
      technologyStack: [],
      originalUrl: 'https://sales-source.example/jobs/1',
      raw: {},
    };
    const store = {
      ...createStore(['sales-source']),
      getActiveProfile: vi.fn(async () => ({
        row: { id: 'profile-1', version: 2 },
        profile: salesProfile,
      })),
      findRawJob: vi.fn(async () => null),
      upsertJob: vi.fn(async () => ({
        job: {
          id: 'sales-job-1',
          availabilityStatus: 'LISTED_UNVERIFIED',
        },
        isNew: true,
        changed: true,
        contentHash: 'sales-content-hash',
      })),
      findEvaluation: vi.fn(async () => null),
      saveEvaluation: vi.fn(async (input: unknown) => {
        void input;
        return { id: 'sales-evaluation-1' };
      }),
      reserveNotification: vi.fn(async () => ({
        row: { id: 'sales-notification-1', status: 'PENDING' },
        reserved: true,
      })),
    };
    const runner = new JobDiscoveryRunner(
      store as never,
      salesProfile,
      72,
      logger,
      [source('sales-source', async () => ({ jobs: [salesJob] }))],
      undefined,
      undefined,
      vi.fn(async () => 'OPEN_CONFIRMED' as const),
    );

    const result = await runner.run({ trigger: 'MANUAL' });

    const savedEvaluation: unknown = store.saveEvaluation.mock.calls[0]?.[0];
    expect(savedEvaluation).toMatchObject({
      profileVersion: 2,
      result: {
        eligibility: 'ELIGIBLE',
      },
    });
    expect(JSON.stringify(savedEvaluation)).toContain(
      'Sales & Business Development category',
    );
    expect(result.alerts[0]?.reasoning).toContain(
      'No professional sales achievements, revenue targets, or managed client portfolio were assumed',
    );
  });
});
