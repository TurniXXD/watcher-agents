import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { ConfigurationStore } from '../configuration-store.js';

describe('ConfigurationStore', () => {
  it('resets only the stocks belonging to the requested Telegram chat', async () => {
    const deleteMany = vi.fn(async () => ({ count: 2 }));
    const database = {
      stock: { deleteMany },
    } as unknown as DatabaseClient;

    await expect(
      new ConfigurationStore(database).resetStocks('chat-1'),
    ).resolves.toEqual({
      count: 2,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { chatConfigId: 'chat-1' },
    });
  });
});
