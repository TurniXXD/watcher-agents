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
      searchBusinesses: vi.fn().mockResolvedValue(companies),
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
      searchBusinesses: vi.fn().mockRejectedValue(new Error('provider down')),
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
    const searchBusinesses = vi.fn();

    const result = await runPeriodicSalesSearch(
      subscription.id,
      store,
      { searchBusinesses } as unknown as SalesService,
      new Set(),
      vi.fn(),
    );

    expect(result).toEqual({ status: 'unauthorized' });
    expect(disableSearchSubscriptions).toHaveBeenCalledWith(
      subscription.telegramChatId,
      subscription.id,
    );
    expect(searchBusinesses).not.toHaveBeenCalled();
  });
});
