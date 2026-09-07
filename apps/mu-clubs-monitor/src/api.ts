import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { WatcherLogger } from '@watcher/core';
import type { MuClubsMonitor } from './monitor.js';
import type { MuClubsStore } from './store.js';

const querySchema = z.object({
  since: z.iso.datetime({ offset: true }).optional(),
  club: z.string().trim().min(1).max(200).optional(),
  minImportance: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const authorized = (header: string | undefined, token: string): boolean => {
  const supplied = header?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const createApi = (
  store: MuClubsStore,
  monitor: MuClubsMonitor,
  token: string,
  logger?: WatcherLogger,
  readinessProbe: () => Promise<void> = () => Promise.resolve(),
) => {
  const app = Fastify();
  app.addHook('onError', (_request, _reply, error) => {
    logger?.error({ err: error }, 'MU Clubs API request failed');
    return Promise.resolve();
  });
  app.get('/healthz', async (_request, reply) => {
    try {
      await readinessProbe();
      return { status: 'ok' };
    } catch (error) {
      logger?.warn({ err: error }, 'MU Clubs readiness probe failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return;
    if (!authorized(request.headers.authorization, token))
      return reply.code(401).send({ error: 'Unauthorized' });
  });
  app.get('/activities', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'Invalid query', issues: parsed.error.issues });
    const activities = await store.listActivities({
      ...(parsed.data.since ? { since: new Date(parsed.data.since) } : {}),
      ...(parsed.data.club ? { club: parsed.data.club } : {}),
      ...(parsed.data.minImportance
        ? { minimumImportance: parsed.data.minImportance }
        : {}),
      limit: parsed.data.limit,
    });
    return { activities };
  });
  app.get('/briefing', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'Invalid query', issues: parsed.error.issues });
    const since = parsed.data.since
      ? new Date(parsed.data.since)
      : new Date(Date.now() - 24 * 60 * 60_000);
    const activities = await store.listActivities({
      since,
      ...(parsed.data.club ? { club: parsed.data.club } : {}),
      minimumImportance: parsed.data.minImportance ?? 3,
      limit: parsed.data.limit,
    });
    return {
      generatedAt: new Date().toISOString(),
      activities: activities.map((activity) => ({
        club: activity.club.name,
        type: activity.type,
        title: activity.title,
        summary: activity.summary,
        startAt: activity.startAt,
        deadlineAt: activity.deadlineAt,
        location: activity.location,
        importance: activity.importance,
        sourceUrl: activity.sourceUrl,
      })),
    };
  });
  app.get('/clubs', async () => ({ clubs: await store.listClubs() }));
  app.post('/run', async (_request, reply) => {
    const result = await monitor.run('MANUAL');
    return reply.code(result.status === 'BUSY' ? 409 : 200).send(result);
  });
  return app;
};
