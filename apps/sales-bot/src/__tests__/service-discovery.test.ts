import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GooglePlacesDiscoveryClient } from '../discovery.js';
import type { GeoapifyDiscoveryClient } from '../geoapify.js';

const sourceMocks = vi.hoisted(() => ({
  searchAresBusinesses: vi.fn(),
  findExactAresCompany: vi.fn(),
}));

vi.mock('@watcher/sources/company', () => sourceMocks);

const { SalesService } = await import('../service.js');

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as WatcherLogger;

describe('SalesService discovery orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('combines Geoapify contacts with matching ARES legal identity', async () => {
    sourceMocks.searchAresBusinesses.mockResolvedValue({
      total: 1,
      subjects: [
        {
          ico: '12345678',
          obchodniJmeno: 'Autoservis Test s.r.o.',
          sidlo: { textovaAdresa: 'Brno' },
          czNace: ['95310'],
        },
      ],
    });
    const geoapifySearch = vi.fn().mockResolvedValue([
      {
        id: 'geo-1',
        name: 'Autoservis Test',
        provider: 'GEOAPIFY',
        sourceUrl: 'https://www.openstreetmap.org/node/1',
        websiteUrl: 'https://autoservis.example',
        phone: '+420 123 456 789',
      },
    ]);
    const geoapify = {
      search: geoapifySearch,
    } as unknown as GeoapifyDiscoveryClient;
    const googleSearch = vi.fn();
    const google = {
      searchDirectory: googleSearch,
    } as unknown as GooglePlacesDiscoveryClient;
    const service = new SalesService(
      {} as SalesStore,
      logger,
      undefined,
      undefined,
      geoapify,
      google,
    );

    const result = await service.searchBusinesses({
      query: 'autoservis',
      locality: 'Brno',
      limit: 1,
    });

    expect(result).toEqual([
      expect.objectContaining({
        provider: 'GEOAPIFY',
        registrationId: '12345678',
        naceCodes: ['95310'],
      }),
    ]);
    expect(googleSearch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        geoapifyCategory: 'service.vehicle.repair.car',
        aresNaceCode: '95310',
      }),
      'Sales business search started',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'GEOAPIFY',
        status: 'completed',
        candidates: 1,
        contactableCandidates: 1,
      }),
      'Sales discovery source completed',
    );
  });

  it('keeps ARES discovery available without either API key', async () => {
    sourceMocks.searchAresBusinesses.mockResolvedValue({
      total: 1,
      subjects: [
        {
          ico: '12345678',
          obchodniJmeno: 'ARES firma',
          sidlo: { textovaAdresa: 'Brno' },
          czNace: ['95310'],
        },
      ],
    });
    const service = new SalesService({} as SalesStore, logger);

    const result = await service.searchBusinesses({
      query: 'autoservis',
      locality: 'Brno',
      limit: 5,
    });

    expect(result).toEqual([
      expect.objectContaining({
        provider: 'ARES',
        registrationId: '12345678',
      }),
    ]);
  });

  it('turns a natural farm query into category filters instead of an ARES name search', async () => {
    sourceMocks.searchAresBusinesses.mockResolvedValue({
      total: 0,
      subjects: [],
    });
    const geoapifySearch = vi.fn().mockResolvedValue([]);
    const service = new SalesService(
      {} as SalesStore,
      logger,
      undefined,
      undefined,
      { search: geoapifySearch } as unknown as GeoapifyDiscoveryClient,
    );

    const result = await service.searchBusinessesDetailed({
      query: 'farmy',
      locality: 'Brno',
      limit: 10,
    });

    expect(result.category).toEqual({
      geoapifyCategory: 'commercial.food_and_drink.farm',
      naceCode: '01',
      source: 'rule',
    });
    expect(sourceMocks.searchAresBusinesses).toHaveBeenCalledWith({
      query: 'nace:01',
      locality: 'Brno',
      limit: 10,
      naceCode: '01',
    });
    expect(geoapifySearch).toHaveBeenCalledWith(
      'farmy',
      'Brno',
      10,
      result.category,
    );
  });

  it('uses Google only as a fallback for missing contact results', async () => {
    sourceMocks.searchAresBusinesses.mockResolvedValue({
      total: 1,
      subjects: [
        {
          ico: '12345678',
          obchodniJmeno: 'ARES firma',
          sidlo: { textovaAdresa: 'Brno' },
        },
      ],
    });
    const geoapifySearch = vi.fn().mockResolvedValue([]);
    const geoapify = {
      search: geoapifySearch,
    } as unknown as GeoapifyDiscoveryClient;
    const googleSearch = vi.fn().mockResolvedValue([
      {
        id: 'google-1',
        name: 'Google firma',
        provider: 'GOOGLE_PLACES',
        sourceUrl: 'https://maps.google.com/example',
        websiteUrl: 'https://google.example',
      },
    ]);
    const google = {
      searchDirectory: googleSearch,
    } as unknown as GooglePlacesDiscoveryClient;
    const service = new SalesService(
      {} as SalesStore,
      logger,
      undefined,
      undefined,
      geoapify,
      google,
    );

    const result = await service.searchBusinesses({
      query: 'neznámý obor',
      locality: 'Brno',
      limit: 2,
    });

    expect(googleSearch).toHaveBeenCalledWith('neznámý obor', 'Brno', 2);
    expect(result.map((candidate) => candidate.provider)).toEqual([
      'GOOGLE_PLACES',
      'ARES',
    ]);
  });

  it('imports only website candidates and preserves their ARES identity', async () => {
    sourceMocks.searchAresBusinesses.mockResolvedValue({
      total: 1,
      subjects: [
        {
          ico: '12345678',
          obchodniJmeno: 'Autoservis Test s.r.o.',
          sidlo: { textovaAdresa: 'Brno' },
          czNace: ['95310'],
        },
      ],
    });
    const geoapify = {
      search: vi.fn().mockResolvedValue([
        {
          id: 'geo-1',
          name: 'Autoservis Test',
          provider: 'GEOAPIFY',
          sourceUrl: 'https://www.openstreetmap.org/node/1',
          websiteUrl: 'https://autoservis.example',
        },
      ]),
    } as unknown as GeoapifyDiscoveryClient;
    const discoverLead = vi.fn().mockResolvedValue({ id: 'lead-1' });
    const store = {
      getCampaign: vi.fn().mockResolvedValue({ id: 'campaign-1' }),
      discoverLead,
    } as unknown as SalesStore;
    const service = new SalesService(
      store,
      logger,
      undefined,
      undefined,
      geoapify,
    );

    await expect(
      service.discoverBusinesses({
        campaignId: 'campaign-1',
        query: 'autoservis',
        locality: 'Brno',
        limit: 5,
      }),
    ).resolves.toEqual({ found: 1, imported: 1 });
    expect(discoverLead).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'GEOAPIFY',
        registrationId: '12345678',
        websiteUrl: 'https://autoservis.example',
      }),
    );
  });
});
