import type { SocialsStore } from '@watcher/database';
import type { NotionClient } from '@watcher/notion';
import { describe, expect, it, vi } from 'vitest';
import { SocialNotionSync } from '../notion.js';

const contentItem = {
  id: 'item-1',
  ownerUserId: 123n,
  weeklyPlanId: null,
  ideaId: 'idea-1',
  title: 'Lokální LLM v CRM',
  channel: 'LINKEDIN' as const,
  format: 'TEXT_POST' as const,
  contentPillar: 'AI a automatizace podnikání',
  targetAudience: 'české firmy',
  objective: 'QUALIFIED_LEADS' as const,
  angle: 'praktická kritéria',
  planningReason: 'reálný projekt',
  similarityWarning: null,
  hook: null,
  cta: null,
  requiredAssets: [],
  plannedAt: new Date('2026-10-19T07:00:00Z'),
  scheduledAt: null,
  publishedAt: null,
  status: 'PLANNED' as const,
  estimatedPreparationMinutes: 45,
  prompt: 'prompt',
  draft: null,
  finalContent: null,
  publishedUrl: null,
  createdAt: new Date('2026-10-13T08:00:00Z'),
  updatedAt: new Date('2026-10-13T09:00:00Z'),
  idea: { id: 'idea-1', description: 'ověřená poznámka' },
  topics: [
    { contentItemId: 'item-1', topicId: 'topic-1', topic: { name: 'AI' } },
  ],
  projects: [],
  sources: [],
};

describe('Notion editorial mirror', () => {
  it('stops instead of overwriting when local and remote changed', async () => {
    const saveExternalSync = vi.fn();
    const updatePage = vi.fn();
    const store = {
      listPendingNotionItems: vi.fn(async () => [contentItem]),
      getExternalSync: vi.fn(async () => ({
        externalId: 'page-1',
        lastLocalHash: 'previous-local-hash',
        lastSyncedAt: new Date('2026-10-13T08:00:00Z'),
      })),
      saveExternalSync,
    } as unknown as SocialsStore;
    const client = {
      retrievePage: vi.fn(async () => ({
        id: 'page-1',
        last_edited_time: '2026-10-13T10:00:00.000Z',
        properties: {},
      })),
      updatePage,
    } as unknown as NotionClient;

    const result = await new SocialNotionSync(
      store,
      client,
      'source-1',
    ).synchronize(123n);

    expect(result).toEqual({ synced: 0, conflicts: 1, failed: 0 });
    expect(updatePage).not.toHaveBeenCalled();
    expect(saveExternalSync).toHaveBeenCalledWith(
      expect.objectContaining({
        localEntityId: 'item-1',
        status: 'CONFLICT',
      }),
    );
  });

  it('creates one idempotency record for a Notion-only mirror page', async () => {
    const saveExternalSync = vi.fn();
    const createPage = vi.fn(async () => ({
      id: 'new-page',
      last_edited_time: '2026-10-13T10:00:00.000Z',
    }));
    const store = {
      listPendingNotionItems: vi.fn(async () => [contentItem]),
      getExternalSync: vi.fn(async () => null),
      saveExternalSync,
    } as unknown as SocialsStore;
    const client = { createPage } as unknown as NotionClient;

    const result = await new SocialNotionSync(
      store,
      client,
      'source-1',
    ).synchronize(123n);

    expect(result).toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(saveExternalSync).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'new-page', status: 'SYNCED' }),
    );
  });
});
