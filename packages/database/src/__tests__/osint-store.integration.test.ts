import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { OsintStore } from '../osint-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const store = database ? new OsintStore(database) : undefined;

describe.skipIf(!database || !store)(
  'OsintStore evidence and ownership',
  () => {
    afterAll(async () => {
      await database?.$disconnect();
    });

    it('deduplicates identical evidence and scopes every read to its owner', async () => {
      const owner = `owner-${randomUUID()}`;
      const other = `other-${randomUUID()}`;
      const investigation = await store!.createInvestigation(
        owner,
        'chat',
        'IČO 25301632',
        [
          {
            type: 'ICO',
            value: '25301632',
            original: 'IČO 25301632',
            depth: 0,
          },
        ],
      );
      const company = {
        kind: 'ORGANIZATION',
        key: 'ico:25301632',
        label: 'Company',
      };
      const address = {
        kind: 'ADDRESS',
        key: 'address:main 1',
        label: 'Main 1',
      };
      const document = {
        sourceKey: 'ares:subject:25301632',
        sourceUrl: 'https://ares.gov.cz/example',
        excerpt: 'Company, IČO 25301632',
        data: { ico: '25301632' },
        findings: [{ entity: company, predicate: 'ICO', value: '25301632' }],
        links: [{ from: company, to: address, type: 'REGISTERED_AT_ADDRESS' }],
      };
      try {
        const first = await store!.ingest(investigation.id, 'ARES', document);
        const second = await store!.ingest(investigation.id, 'ARES', document);
        expect(first.isNew).toBe(true);
        expect(second).toEqual({ id: first.id, isNew: false });
        expect(await store!.listEvidence(owner, investigation.id)).toHaveLength(
          1,
        );
        expect(
          await store!.listRelationships(owner, investigation.id),
        ).toHaveLength(1);
        expect(await store!.getEvidence(other, first.id)).toBeNull();
        expect(await store!.listEvidence(other, investigation.id)).toHaveLength(
          0,
        );
        expect(
          await store!.getInvestigation(other, investigation.id),
        ).toBeNull();
      } finally {
        await database!.osintInvestigation.delete({
          where: { id: investigation.id },
        });
      }
    });
  },
);
