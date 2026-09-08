import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { WatcherLogger } from '@watcher/core';
import { eventCategorySchema } from '../domain/types.js';
import type { EventRepository } from '../repositories/event-repository.js';
import type { EventRunner } from '../services/runner.js';

const querySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  minRelevance: z.coerce.number().int().min(0).max(100).optional(),
  category: eventCategorySchema.optional(),
  source: z.string().optional(),
  free: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const authorized = (header: string | undefined, token: string): boolean => {
  const supplied = header?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!supplied) return false;
  const a = Buffer.from(supplied),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};
const compact = (
  event: Awaited<ReturnType<EventRepository['list']>>[number],
) => ({
  id: event.id,
  title: event.title,
  startAt: event.startAt,
  endAt: event.endAt,
  venue: { name: event.venueName, address: event.venueAddress },
  categories: event.categories,
  relevanceScore: event.relevanceScore,
  relevanceReasons: event.relevanceReasons,
  registrationRequired: event.registrationRequired,
  registrationUrl: event.registrationUrl,
  registrationDeadline: event.registrationDeadline,
  free: event.priceFree,
  sources: event.sourceLinks.map((link) => ({
    id: link.sourceId,
    eventUrl: link.eventUrl,
  })),
});

export const createApi = (
  repository: EventRepository,
  runner: EventRunner,
  token: string,
  readiness: () => Promise<void>,
  logger?: WatcherLogger,
) => {
  const app = Fastify();
  app.addHook('onError', (_request, _reply, error) => {
    logger?.error({ err: error }, 'Brno Events API request failed');
    return Promise.resolve();
  });
  app.get('/health', async (_request, reply) => {
    try {
      await readiness();
      return { status: 'ok', sources: runner.sourceIds() };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (!authorized(request.headers.authorization, token))
      return reply.code(401).send({ error: 'Unauthorized' });
  });
  const list = async (
    request: { query: unknown },
    reply: { code(code: number): { send(value: unknown): unknown } },
    defaults: { from?: Date; to?: Date } = {},
  ) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'Invalid query', issues: parsed.error.issues });
    return repository.list({
      ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
      ...(!parsed.data.from && defaults.from ? { from: defaults.from } : {}),
      ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {}),
      ...(!parsed.data.to && defaults.to ? { to: defaults.to } : {}),
      ...(parsed.data.minRelevance !== undefined
        ? { minRelevance: parsed.data.minRelevance }
        : {}),
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
      ...(parsed.data.source ? { source: parsed.data.source } : {}),
      ...(parsed.data.free !== undefined ? { free: parsed.data.free } : {}),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  };
  app.get('/events', (request, reply) => list(request, reply));
  app.get('/events/upcoming', (request, reply) => {
    const now = new Date();
    return list(request, reply, {
      from: now,
      to: new Date(now.getTime() + 14 * 86_400_000),
    });
  });
  app.get('/events/briefing', async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 14 * 86_400_000);
    const events = await repository.list({
      from: now,
      to: end,
      minRelevance: 60,
      limit: 200,
      offset: 0,
    });
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);
    const tomorrowEnd = new Date(dayEnd.getTime() + 86_400_000);
    const weekday = now.getDay();
    const untilSaturday = (6 - weekday + 7) % 7;
    const weekendStart = new Date(now);
    weekendStart.setHours(0, 0, 0, 0);
    weekendStart.setDate(weekendStart.getDate() + untilSaturday);
    const weekendEnd = new Date(weekendStart);
    weekendEnd.setDate(weekendEnd.getDate() + 2);
    const recent = new Date(now.getTime() - 24 * 60 * 60_000);
    return {
      generatedAt: now.toISOString(),
      today: events.filter((e) => e.startAt <= dayEnd).map(compact),
      tomorrow: events
        .filter((e) => e.startAt > dayEnd && e.startAt <= tomorrowEnd)
        .map(compact),
      thisWeekend: events
        .filter((e) => e.startAt >= weekendStart && e.startAt < weekendEnd)
        .map(compact),
      newInterestingEvents: events
        .filter((e) => e.firstSeenAt >= recent && e.relevanceScore >= 80)
        .map(compact),
      registrationDeadlines: events
        .filter(
          (e) =>
            e.registrationDeadline &&
            e.registrationDeadline >= now &&
            e.registrationDeadline <= end,
        )
        .map(compact),
      topUpcoming: events.slice(0, 20).map(compact),
    };
  });
  app.get('/events/:id', async (request, reply) => {
    const id = z.uuid().safeParse((request.params as { id?: unknown }).id);
    if (!id.success) return reply.code(400).send({ error: 'Invalid event id' });
    const event = await repository.get(id.data);
    return event ?? reply.code(404).send({ error: 'Not found' });
  });
  app.post('/run', async () => runner.run());
  app.post('/run/:source', async (request, reply) => {
    try {
      return await runner.run(
        z.string().parse((request.params as { source?: unknown }).source),
      );
    } catch (error) {
      return reply.code(404).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return app;
};
