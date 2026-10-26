import type { JobStore } from '@watcher/database';
import type { NotionClient } from '@watcher/notion';
import { describe, expect, it, vi } from 'vitest';
import { JobsNotionSync, type JobNotionRecord } from '../notion.js';

const record: JobNotionRecord = {
  jobId: 'job-1',
  job: {
    sourceId: 'fixture',
    externalId: 'external-1',
    title: 'Full-Stack TypeScript Developer',
    company: 'Example',
    description: 'Build React and Node.js products in English.',
    location: 'Berlin, Germany',
    workMode: 'ONSITE',
    remoteRegions: [],
    technologyStack: ['React', 'TypeScript'],
    originalUrl: 'https://jobs.example/job-1',
    canonicalApplicationUrl: 'https://example.com/apply/job-1',
    publishedAt: new Date('2026-10-25T08:00:00.000Z'),
    raw: {},
  },
  evaluation: {
    score: 84,
    eligibility: 'ELIGIBLE',
    recommendation: 'STRONG',
    hardBlockers: [],
    uncertainties: [],
  },
  sourceName: 'Fixture Jobs',
  firstSeenAt: new Date('2026-10-26T08:00:00.000Z'),
};

const store = () => ({
  claimNotionSync: vi.fn(
    async (input: { jobId: string; contentHash: string }) => {
      void input;
      return { claimed: true, row: { pageId: null } };
    },
  ),
  completeNotionSync: vi.fn(
    async (input: { jobId: string; pageId: string; contentHash: string }) =>
      void input,
  ),
  failNotionSync: vi.fn(
    async (jobId: string, error: unknown) => void [jobId, error],
  ),
});

describe('Jobs Notion mirror', () => {
  it('creates one page with evaluation and source evidence', async () => {
    const database = store();
    const client = {
      queryDataSource: vi.fn(async () => ({
        results: [],
        has_more: false,
        next_cursor: null,
      })),
      createPage: vi.fn(
        async (
          body: Record<string, unknown>,
          signal?: AbortSignal,
        ): Promise<Record<string, unknown>> => {
          void [body, signal];
          return { id: 'notion-page-1' };
        },
      ),
      updatePage: vi.fn(
        async (
          pageId: string,
          body: Record<string, unknown>,
          signal?: AbortSignal,
        ) => void [pageId, body, signal],
      ),
    };
    const sync = new JobsNotionSync(
      database as unknown as JobStore,
      client as unknown as NotionClient,
      'jobs-data-source',
    );

    await expect(sync.synchronize(record)).resolves.toBe(true);

    const [createBody, createSignal] = client.createPage.mock.calls[0]!;
    expect(createBody).toMatchObject({
      parent: {
        type: 'data_source_id',
        data_source_id: 'jobs-data-source',
      },
    });
    const properties = createBody.properties as Record<string, unknown>;
    expect(properties['Role title']).toBeDefined();
    expect(properties.Eligibility).toEqual({ select: { name: 'ELIGIBLE' } });
    expect(properties.Score).toEqual({ number: 84 });
    expect(properties['Watcher Job ID']).toBeDefined();
    expect(createSignal).toBeInstanceOf(AbortSignal);
    const [completed] = database.completeNotionSync.mock.calls[0]!;
    expect(completed).toMatchObject({
      jobId: 'job-1',
      pageId: 'notion-page-1',
    });
    expect(typeof completed.contentHash).toBe('string');
  });

  it('reuses a page found after an interrupted local save', async () => {
    const database = store();
    const client = {
      queryDataSource: vi.fn(async () => ({
        results: [{ id: 'existing-page' }],
        has_more: false,
        next_cursor: null,
      })),
      createPage: vi.fn(),
      updatePage: vi.fn(
        async (
          pageId: string,
          body: Record<string, unknown>,
          signal?: AbortSignal,
        ) => {
          void [pageId, body, signal];
          return { id: 'existing-page' };
        },
      ),
    };
    const sync = new JobsNotionSync(
      database as unknown as JobStore,
      client as unknown as NotionClient,
      'jobs-data-source',
    );

    await sync.synchronize(record);

    expect(client.createPage).not.toHaveBeenCalled();
    const [pageId, updateBody, updateSignal] = client.updatePage.mock.calls[0]!;
    expect(pageId).toBe('existing-page');
    expect(updateBody.properties).toBeDefined();
    expect(updateSignal).toBeInstanceOf(AbortSignal);
  });

  it('records a retryable failure without hiding it', async () => {
    const database = store();
    const error = new Error('Notion unavailable');
    const client = {
      queryDataSource: vi.fn(async () => {
        throw error;
      }),
    };
    const sync = new JobsNotionSync(
      database as unknown as JobStore,
      client as unknown as NotionClient,
      'jobs-data-source',
    );

    await expect(sync.synchronize(record)).rejects.toThrow(
      'Notion unavailable',
    );
    expect(database.failNotionSync).toHaveBeenCalledWith('job-1', error);
  });
});
