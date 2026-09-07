import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api.js';
import type { MuClubsMonitor } from '../monitor.js';
import type { MuClubsStore } from '../store.js';

const applications: ReturnType<typeof createApi>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

const application = () => {
  const store = {
    listActivities: vi.fn().mockResolvedValue([]),
    listClubs: vi.fn().mockResolvedValue([]),
  } as unknown as MuClubsStore;
  const run = vi.fn().mockResolvedValue({
    status: 'SUCCESS',
    sourceCount: 0,
    fetchedCount: 0,
    activityCount: 0,
    sourceFailures: [],
    briefingPublished: 0,
  });
  const monitor = { run } as unknown as MuClubsMonitor;
  const app = createApi(store, monitor, 'test-token-at-least-16');
  applications.push(app);
  return { app, store, run };
};

describe('MU Clubs API', () => {
  it('keeps health public but requires a bearer token for data', async () => {
    const { app } = application();
    expect(
      (await app.inject({ method: 'GET', url: '/healthz' })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/activities' })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/activities',
          headers: { authorization: 'Bearer test-token-at-least-16' },
        })
      ).json(),
    ).toEqual({ activities: [] });
  });

  it('runs the monitor through the authenticated manual endpoint', async () => {
    const { app, run } = application();
    const response = await app.inject({
      method: 'POST',
      url: '/run',
      headers: { authorization: 'Bearer test-token-at-least-16' },
    });
    expect(response.statusCode).toBe(200);
    expect(run).toHaveBeenCalledWith('MANUAL');
  });
});
