import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { NewsConfigurationStore } from '../news-configuration-store.js';

describe('NewsConfigurationStore category preferences', () => {
  it('defaults SPORT off for both Czech and Global without changing later choices', async () => {
    const createMany = vi.fn<
      (input: {
        data: Array<{
          chatConfigId: string;
          scope: 'CZECH' | 'GLOBAL';
          category: string;
          enabled: boolean;
        }>;
        skipDuplicates: boolean;
      }) => Promise<{ count: number }>
    >(async () => ({ count: 22 }));
    const database = {
      newsCategoryPreference: { createMany },
    } as unknown as DatabaseClient;

    await new NewsConfigurationStore(database).syncCategoryPreferences(
      'chat-config',
    );

    expect(createMany).toHaveBeenCalledOnce();
    const input = createMany.mock.calls[0]?.[0];
    if (!input)
      throw new Error('Expected category preference createMany input');
    expect(input.skipDuplicates).toBe(true);
    expect(input.data).toHaveLength(22);
    expect(input.data).toEqual(
      expect.arrayContaining([
        {
          chatConfigId: 'chat-config',
          scope: 'CZECH',
          category: 'SPORT',
          enabled: false,
        },
        {
          chatConfigId: 'chat-config',
          scope: 'GLOBAL',
          category: 'SPORT',
          enabled: false,
        },
      ]),
    );
    expect(
      input.data
        .filter(({ category }) => category !== 'SPORT')
        .every(({ enabled }) => enabled),
    ).toBe(true);
  });

  it('persists an explicit category switch for one profile', async () => {
    const upsert = vi.fn(async () => ({
      scope: 'GLOBAL' as const,
      category: 'SPORT' as const,
      enabled: true,
    }));
    const database = {
      newsCategoryPreference: { upsert },
    } as unknown as DatabaseClient;

    await expect(
      new NewsConfigurationStore(database).setCategoryEnabled(
        'chat-config',
        'GLOBAL',
        'SPORT',
        true,
      ),
    ).resolves.toEqual({ scope: 'GLOBAL', category: 'SPORT', enabled: true });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        chatConfigId_scope_category: {
          chatConfigId: 'chat-config',
          scope: 'GLOBAL',
          category: 'SPORT',
        },
      },
      create: {
        chatConfigId: 'chat-config',
        scope: 'GLOBAL',
        category: 'SPORT',
        enabled: true,
      },
      update: { enabled: true },
      select: { scope: true, category: true, enabled: true },
    });
  });
});
