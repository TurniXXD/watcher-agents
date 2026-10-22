import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TwentyIntegration } from '../integrations/twenty/index.js';

const auditWebsite = vi.hoisted(() => vi.fn());

vi.mock('../providers.js', async () => {
  const actual: Record<string, unknown> =
    await vi.importActual('../providers.js');
  return { ...actual, auditWebsite };
});

import { SalesService } from '../service.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as WatcherLogger;

const discoveredCompany = {
  id: 'geo-1',
  name: 'Autoservis Test',
  provider: 'GEOAPIFY' as const,
  sourceUrl: 'https://www.openstreetmap.org/node/1',
  websiteUrl: 'https://autoservis.example',
  address: 'Brno',
  registrationId: '12345678',
  email: 'directory@autoservis.example',
  phone: '+420 111 222 333',
};

const category = {
  geoapifyCategory: 'service.vehicle.repair.car',
  naceCode: '95310',
  source: 'rule' as const,
};

describe('campaign-free prospect synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditWebsite.mockResolvedValue({
      sourceUrl: 'https://autoservis.example/',
      title: 'Autoservis Test',
      textExcerpt: 'Autoservis v Brně',
      contactTextExcerpt: 'info@autoservis.example +420 777 888 999',
      alternateLanguages: [],
      hasContactPage: true,
      hasPrivacyPage: true,
      hasMobileViewport: true,
      hasDescription: true,
      foundEmail: 'info@autoservis.example',
      emailSourceUrl: 'https://autoservis.example/kontakt',
      foundPhone: '+420 777 888 999',
      phoneSourceUrl: 'https://autoservis.example/kontakt',
    });
  });

  it('stores a new prospect and creates an idempotent Twenty company and contact note', async () => {
    const prospect = {
      id: 'prospect-1',
      query: 'autoservis',
      locality: 'Brno',
      companyName: discoveredCompany.name,
      websiteUrl: 'https://autoservis.example/',
      domain: 'autoservis.example',
      location: 'Brno',
      registrationId: '12345678',
      email: 'info@autoservis.example',
      phone: '+420 777 888 999',
      contactSourceUrl: 'https://autoservis.example/kontakt',
      source: 'GEOAPIFY',
      sourceExternalId: 'geo-1',
      sourceUrl: discoveredCompany.sourceUrl,
      twentyCompanyId: null,
      twentyContactNoteId: null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      syncedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const upsertProspect = vi
      .fn<SalesStore['upsertProspect']>()
      .mockResolvedValue({
        prospect,
        created: true,
        needsSync: true,
      });
    const markProspectSynced = vi
      .fn<SalesStore['markProspectSynced']>()
      .mockResolvedValue(prospect);
    const store = {
      findProspect: vi.fn().mockResolvedValue(null),
      upsertProspect,
      markProspectSynced,
      markProspectSyncFailed: vi.fn().mockResolvedValue(undefined),
    } as unknown as SalesStore;
    const upsertCompany = vi
      .fn<TwentyIntegration['upsertCompany']>()
      .mockResolvedValue({ id: 'company-1' });
    const recordInteraction = vi
      .fn<TwentyIntegration['recordInteraction']>()
      .mockResolvedValue({ id: 'note-1' });
    const twenty = {
      upsertCompany,
      recordInteraction,
    } as unknown as TwentyIntegration;
    const service = new SalesService(store, logger, undefined, twenty);
    vi.spyOn(service, 'searchBusinessesDetailed').mockResolvedValue({
      companies: [discoveredCompany],
      category,
    });

    await expect(
      service.syncProspects({
        query: 'autoservis',
        locality: 'Brno',
        limit: 10,
      }),
    ).resolves.toMatchObject({
      found: 1,
      withWebsite: 1,
      created: 1,
      alreadyPresent: 0,
      synced: 1,
      failures: [],
    });
    expect(upsertProspect).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Autoservis Test',
        email: 'info@autoservis.example',
        phone: '+420 777 888 999',
        contactSourceUrl: 'https://autoservis.example/kontakt',
      }),
    );
    expect(upsertCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Autoservis Test',
        domain: 'autoservis.example',
        externalId: 'sales-prospect:prospect-1',
      }),
    );
    expect(recordInteraction).toHaveBeenCalledOnce();
    const interaction = recordInteraction.mock.calls[0]?.[0];
    expect(interaction).toMatchObject({
      companyId: 'company-1',
    });
    expect(interaction?.body).toContain('Email: info@autoservis.example');
    expect(interaction?.body).toContain('Phone: +420 777 888 999');
    expect(markProspectSynced).toHaveBeenCalledWith('prospect-1', {
      companyId: 'company-1',
      contactNoteId: 'note-1',
    });
  });

  it('skips website work and Twenty writes when PostgreSQL already records a complete sync', async () => {
    const upsertProspect = vi.fn<SalesStore['upsertProspect']>();
    const upsertCompany = vi.fn<TwentyIntegration['upsertCompany']>();
    const store = {
      findProspect: vi.fn().mockResolvedValue({
        syncedAt: new Date(),
        twentyCompanyId: 'company-1',
        twentyContactNoteId: 'note-1',
      }),
      upsertProspect,
    } as unknown as SalesStore;
    const twenty = {
      upsertCompany,
      recordInteraction: vi.fn(),
    } as unknown as TwentyIntegration;
    const service = new SalesService(store, logger, undefined, twenty);
    vi.spyOn(service, 'searchBusinessesDetailed').mockResolvedValue({
      companies: [discoveredCompany],
      category,
    });

    await expect(
      service.syncProspects({
        query: 'autoservis',
        locality: 'Brno',
        limit: 10,
      }),
    ).resolves.toMatchObject({
      found: 1,
      alreadyPresent: 1,
      synced: 0,
    });
    expect(auditWebsite).not.toHaveBeenCalled();
    expect(upsertProspect).not.toHaveBeenCalled();
    expect(upsertCompany).not.toHaveBeenCalled();
  });
});
