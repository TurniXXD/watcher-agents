import { createDatabaseClient } from '@watcher/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HeuristicActivityClassifier } from '../classifier.js';
import { clubRegistry } from '../registry.js';
import { MuClubsStore } from '../store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('MU Clubs persistence', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);
  const store = new MuClubsStore(database);

  beforeEach(async () => {
    await database.muSourceRun.deleteMany();
    await database.muMonitorRun.deleteMany();
    await database.muMonitorState.deleteMany();
    await database.muClubActivity.deleteMany();
    await database.muClubSource.deleteMany();
    await database.muClub.deleteMany();
  });

  afterAll(async () => database.$disconnect());

  it('seeds active and excluded clubs and deduplicates activities durably', async () => {
    await store.seedRegistry(clubRegistry);
    const clubs = await store.listClubs();
    expect(clubs.filter(({ status }) => status === 'ACTIVE')).toHaveLength(8);
    expect(
      clubs.filter(({ status }) => status === 'NO_MONITORABLE_SOURCE'),
    ).toHaveLength(4);
    expect(clubs.find(({ id }) => id === 'grey-colab')?.sources).toHaveLength(
      0,
    );

    const candidate = {
      sourceId: 'ifmsa-brno-instagram',
      externalItemId: 'post-1',
      title: 'Workshop',
      content: 'Registrace na workshop 15. 9. v 18:00',
      sourceUrl: 'https://www.instagram.com/p/post-1/',
    };
    const classified = new HeuristicActivityClassifier().classify(
      candidate,
      new Date('2026-08-01T00:00:00Z'),
    );
    const first = await store.saveActivity(
      'ifmsa-brno',
      candidate.sourceId,
      candidate,
      classified,
    );
    const duplicate = await store.saveActivity(
      'ifmsa-brno',
      candidate.sourceId,
      candidate,
      classified,
    );
    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({
      created: false,
      activity: { id: first.activity.id },
    });
    expect(await store.listActivities({ club: 'ifmsa-brno' })).toHaveLength(1);
  });

  it('prevents overlapping monitor runs', async () => {
    expect(await store.claimRun('SCHEDULED')).toBeDefined();
    expect(await store.claimRun('MANUAL')).toBeUndefined();
  });
});
