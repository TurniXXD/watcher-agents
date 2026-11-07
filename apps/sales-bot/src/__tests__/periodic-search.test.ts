import type { SalesStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { SalesService } from '../service.js';
import { runPeriodicSalesSearch } from '../periodic-search.js';

const subscription = {
  id: 'search-1',
  telegramChatId: 123n,
  telegramUserId: 123n,
  query: 'architekti',
  locality: 'Brno',
  resultLimit: 10,
  enabled: true,
};

describe('periodic sales search', () => {
  it('imports a continuous page into Twenty and advances the persisted cursor', async () => {
    const completeSearchSubscription = vi.fn().mockResolvedValue(undefined);
    const store = {
      getSearchSubscription: vi.fn().mockResolvedValue({
        ...subscription,
        autoImportToCrm: true,
        pageOffset: 40,
      }),
      completeSearchSubscription,
      failSearchSubscription: vi.fn(),
    } as unknown as SalesStore;
    const syncProspects = vi
      .fn()
      .mockResolvedValue({ found: 10, synced: 8, failures: [] });
    const sendMessage = vi.fn();
    const result = await runPeriodicSalesSearch(
      subscription.id,
      store,
      { syncProspects } as unknown as SalesService,
      new Set([123]),
      sendMessage,
    );
    expect(syncProspects).toHaveBeenCalledWith({
      query: 'architekti',
      locality: 'Brno',
      limit: 10,
      offset: 40,
    });
    expect(completeSearchSubscription).toHaveBeenCalledWith(
      subscription.id,
      [],
      50,
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'imported', found: 10, synced: 8 });
  });

  it('wraps an exhausted continuous search to its first page', async () => {
    const completeSearchSubscription = vi.fn().mockResolvedValue(undefined);
    const store = {
      getSearchSubscription: vi.fn().mockResolvedValue({
        ...subscription,
        autoImportToCrm: true,
        pageOffset: 40,
      }),
      completeSearchSubscription,
      failSearchSubscription: vi.fn(),
    } as unknown as SalesStore;
    await runPeriodicSalesSearch(
      subscription.id,
      store,
      {
        syncProspects: vi
          .fn()
          .mockResolvedValue({ found: 0, synced: 0, failures: [] }),
      } as unknown as SalesService,
      new Set([123]),
      vi.fn(),
    );
    expect(completeSearchSubscription).toHaveBeenCalledWith(
      subscription.id,
      [],
      0,
    );
  });

  it('keeps the cursor on a page with CRM failures for retry', async () => {
    const failSearchSubscription = vi.fn().mockResolvedValue(undefined);
    const completeSearchSubscription = vi.fn();
    const store = {
      getSearchSubscription: vi.fn().mockResolvedValue({
        ...subscription,
        autoImportToCrm: true,
        pageOffset: 40,
      }),
      completeSearchSubscription,
      failSearchSubscription,
    } as unknown as SalesStore;
    await expect(
      runPeriodicSalesSearch(
        subscription.id,
        store,
        {
          syncProspects: vi.fn().mockResolvedValue({
            found: 10,
            synced: 8,
            failures: [{ companyName: 'X', error: 'CRM unavailable' }],
          }),
        } as unknown as SalesService,
        new Set([123]),
        vi.fn(),
      ),
    ).rejects.toThrow('CRM unavailable');
    expect(completeSearchSubscription).not.toHaveBeenCalled();
    expect(failSearchSubscription).toHaveBeenCalledWith(
      subscription.id,
      'CRM unavailable',
    );
  });
  it('sends only unseen results and records all observed identities', async () => {
    const companies = [
      {
        id: 'old',
        name: 'Old Studio',
        provider: 'ARES' as const,
        sourceUrl: 'https://ares.gov.cz/old',
        registrationId: '11111111',
      },
      {
        id: 'new',
        name: 'New Studio',
        provider: 'GEOAPIFY' as const,
        sourceUrl: 'https://example.test/new',
        registrationId: '22222222',
      },
    ];
    const completeSearchSubscription = vi.fn().mockResolvedValue(undefined);
    const store = {
      getSearchSubscription: vi.fn().mockResolvedValue(subscription),
      unseenSearchResultKeys: vi
        .fn()
        .mockImplementation(
          async (_id: string, keys: string[]) => new Set([keys[1]]),
        ),
      completeSearchSubscription,
      failSearchSubscription: vi.fn(),
    } as unknown as SalesStore;
    const service = {
      searchBusinessesDetailed: vi.fn().mockResolvedValue({
        companies,
        category: {
          geoapifyCategory: 'office',
          source: 'ai',
        },
      }),
    } as unknown as SalesService;
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const result = await runPeriodicSalesSearch(
      subscription.id,
      store,
      service,
      new Set([123]),
      sendMessage,
    );

    expect(result).toEqual({ status: 'completed', found: 2, sent: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('New Studio'),
    );
    expect(sendMessage.mock.calls[0]?.[1]).not.toContain('Old Studio');
    expect(sendMessage.mock.calls[0]?.[1]).toContain(
      'Geoapify kategorie: office',
    );
    expect(completeSearchSubscription).toHaveBeenCalledWith(subscription.id, [
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('stores an error and rejects when discovery fails', async () => {
    const failSearchSubscription = vi.fn().mockResolvedValue(undefined);
    const store = {
      getSearchSubscription: vi.fn().mockResolvedValue(subscription),
      failSearchSubscription,
    } as unknown as SalesStore;
    const service = {
      searchBusinessesDetailed: vi
        .fn()
        .mockRejectedValue(new Error('provider down')),
    } as unknown as SalesService;

    await expect(
      runPeriodicSalesSearch(
        subscription.id,
        store,
        service,
        new Set([123]),
        vi.fn(),
      ),
    ).rejects.toThrow('provider down');
    expect(failSearchSubscription).toHaveBeenCalledWith(
      subscription.id,
      'provider down',
    );
  });

  it('disables a search whose owner is no longer authorized', async () => {
    const disableSearchSubscriptions = vi.fn().mockResolvedValue(1);
    const store = {
      getSearchSubscription: vi.fn().mockResolvedValue(subscription),
      disableSearchSubscriptions,
    } as unknown as SalesStore;
    const searchBusinessesDetailed = vi.fn();

    const result = await runPeriodicSalesSearch(
      subscription.id,
      store,
      { searchBusinessesDetailed } as unknown as SalesService,
      new Set(),
      vi.fn(),
    );

    expect(result).toEqual({ status: 'unauthorized' });
    expect(disableSearchSubscriptions).toHaveBeenCalledWith(
      subscription.telegramChatId,
      subscription.id,
    );
    expect(searchBusinessesDetailed).not.toHaveBeenCalled();
  });
});
