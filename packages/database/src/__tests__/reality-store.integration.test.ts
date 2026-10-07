import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { RealityStore } from '../reality-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const store = database ? new RealityStore(database) : undefined;

describe.skipIf(!database || !store)('RealityStore with PostgreSQL', () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it('rejects overlapping reports and keeps listing price history', async () => {
    const suffix = randomUUID();
    const chatId = BigInt(`9${Date.now()}${Math.floor(Math.random() * 1000)}`);
    const source = `test-${suffix}`;
    const externalId = `listing-${suffix}`;
    const user = await store!.ensureUser(chatId);
    try {
      const run = await store!.claimRun(user.id, 'MANUAL');
      expect(run).toBeDefined();
      await expect(
        store!.claimRun(user.id, 'SCHEDULED'),
      ).resolves.toBeUndefined();

      const first = await store!.upsertListing({
        source,
        externalId,
        url: 'https://example.com/listing',
        title: 'Test listing',
        location: 'Ostrava',
        priceCzk: 2_900_000,
        floorAreaM2: 50,
        raw: {},
      });
      const second = await store!.upsertListing({
        source,
        externalId,
        url: 'https://example.com/listing',
        title: 'Test listing',
        location: 'Ostrava',
        priceCzk: 2_600_000,
        floorAreaM2: 50,
        raw: {},
      });
      const listings = await store!.listActiveListings(['Ostrava']);
      const listing = listings.find((item) => item.id === second.listing.id);

      expect(first.isNew).toBe(true);
      expect(second.isNew).toBe(false);
      expect(second.priceChanged).toBe(true);
      expect(listing?.prices.map(({ priceCzk }) => Number(priceCzk))).toEqual([
        2_900_000, 2_600_000,
      ]);
    } finally {
      await database!.realityListing.deleteMany({ where: { source } });
      await database!.realityUser.delete({ where: { id: user.id } });
    }
  });
});
