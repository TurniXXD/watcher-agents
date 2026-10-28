import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { TwentyIntegration } from '../integrations/twenty/index.js';
import { SalesService } from '../service.js';

describe('link-to-lead Twenty synchronization', () => {
  it('upserts the researched Company and sourced Note after confirmation', async () => {
    const researchedAt = new Date('2026-10-29T08:00:00.000Z');
    const getLeadWithResearch = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      companyName: 'Example s.r.o.',
      websiteUrl: 'https://www.example.com/',
      source: 'TELEGRAM_URL',
      sourceExternalId: 'domain-hash',
      sourceUrl: 'https://example.com/',
      location: 'Brno',
      email: 'info@example.com',
      phone: '+420123456789',
      contactSourceUrl: 'https://example.com/contact',
      phoneSourceUrl: null,
      research: {
        researchedAt,
        sourceUrls: ['https://example.com/', 'https://example.com/contact'],
      },
    });
    const setTwentySyncIds = vi.fn().mockResolvedValue(undefined);
    const upsertCompany = vi.fn().mockResolvedValue({ id: 'company-1' });
    const recordInteraction = vi.fn().mockResolvedValue({ id: 'note-1' });
    const service = new SalesService(
      {
        getLeadWithResearch,
        setTwentySyncIds,
      } as unknown as SalesStore,
      {} as WatcherLogger,
      undefined,
      { upsertCompany, recordInteraction } as unknown as TwentyIntegration,
    );

    await expect(
      service.syncLinkedLeadToTwenty('11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual({ companyId: 'company-1' });

    expect(upsertCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Example s.r.o.',
        domain: 'example.com',
        externalId: 'TELEGRAM_URL:domain-hash',
        lastResearchedAt: researchedAt,
      }),
    );
    expect(recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        externalId: 'link-to-lead:11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(setTwentySyncIds).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      { companyId: 'company-1', draftNoteId: 'note-1' },
    );
  });

  it('fails closed when Twenty is not configured', async () => {
    const service = new SalesService({} as SalesStore, {} as WatcherLogger);
    await expect(service.syncLinkedLeadToTwenty('lead-1')).rejects.toThrow(
      'Twenty CRM is not configured',
    );
  });
});
