import { errorMessage, type WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import type { SalesService } from './service.js';
import {
  renderSalesSearchTableMessages,
  salesSearchResultKey,
} from './search-table.js';

export type PeriodicSearchResult =
  | { status: 'missing_or_disabled' }
  | { status: 'unauthorized' }
  | { status: 'completed'; found: number; sent: number };

export const runPeriodicSalesSearch = async (
  subscriptionId: string,
  store: SalesStore,
  service: SalesService,
  allowedUserIds: ReadonlySet<number>,
  sendMessage: (chatId: string, message: string) => Promise<void>,
  logger?: WatcherLogger,
): Promise<PeriodicSearchResult> => {
  const subscription = await store.getSearchSubscription(subscriptionId);
  if (!subscription?.enabled) return { status: 'missing_or_disabled' };

  if (!allowedUserIds.has(Number(subscription.telegramUserId))) {
    await store.disableSearchSubscriptions(
      subscription.telegramChatId,
      subscription.id,
    );
    logger?.warn(
      { subscriptionId },
      'Periodic sales search disabled because its owner is not allowed',
    );
    return { status: 'unauthorized' };
  }

  try {
    const companies = await service.searchBusinesses({
      query: subscription.query,
      locality: subscription.locality,
      limit: subscription.resultLimit,
    });
    const resultKeys = companies.map(salesSearchResultKey);
    const unseenKeys = await store.unseenSearchResultKeys(
      subscription.id,
      resultKeys,
    );
    const newCompanies = companies.filter((company) =>
      unseenKeys.has(salesSearchResultKey(company)),
    );
    for (const message of renderSalesSearchTableMessages(
      newCompanies,
      subscription.query,
      subscription.locality,
    )) {
      await sendMessage(subscription.telegramChatId.toString(), message);
    }
    await store.completeSearchSubscription(subscription.id, [
      ...new Set(resultKeys),
    ]);
    logger?.info(
      {
        subscriptionId,
        found: companies.length,
        sent: newCompanies.length,
      },
      'Periodic sales search completed',
    );
    return {
      status: 'completed',
      found: companies.length,
      sent: newCompanies.length,
    };
  } catch (error) {
    await store.failSearchSubscription(subscription.id, errorMessage(error));
    throw error;
  }
};
