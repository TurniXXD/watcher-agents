import { timingSafeEqual } from 'node:crypto';
import type { WatcherLogger } from '@watcher/core';
import type { MaintenanceStore } from '@watcher/database';
import Fastify from 'fastify';
import { z } from 'zod';
import type { MaintenanceEngine } from './evaluation/engine.js';

const authorized = (header: string | undefined, token: string): boolean => {
  const supplied = header?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const findingQuery = z.object({
  agent: z.string().min(1).optional(),
  type: z
    .enum([
      'RECURRING_FAILURE',
      'NOISY_OUTPUT',
      'STALE_SOURCE',
      'DUPLICATE_OUTPUT',
      'POOR_CLASSIFICATION',
      'HIGH_LATENCY',
      'HIGH_COST',
      'LOW_VALUE_OUTPUT',
      'SOURCE_DEGRADATION',
      'SCHEDULE_ISSUE',
      'CONFIGURATION_ISSUE',
      'OTHER',
    ])
    .optional(),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED']).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const recommendationQuery = z.object({
  agent: z.string().min(1).optional(),
  type: z
    .enum([
      'PROMPT_CHANGE',
      'SOURCE_CHANGE',
      'SCRAPER_CHANGE',
      'CONFIG_CHANGE',
      'THRESHOLD_CHANGE',
      'SCHEDULE_CHANGE',
      'MODEL_CHANGE',
      'CODE_CHANGE',
      'REMOVE_SOURCE',
      'ADD_SOURCE',
      'OTHER',
    ])
    .optional(),
  status: z
    .enum(['PROPOSED', 'APPROVED', 'REJECTED', 'IMPLEMENTED'])
    .optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const manualRunSchema = z.object({
  lookbackHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .default(24 * 7),
});

const healthForSeverity = (severity: string | undefined) =>
  severity === 'CRITICAL' || severity === 'HIGH'
    ? 'critical'
    : severity === 'MEDIUM'
      ? 'warning'
      : 'healthy';

export const createMaintenanceApi = (
  store: MaintenanceStore,
  engine: MaintenanceEngine,
  token: string,
  readiness: () => Promise<void>,
  logger: WatcherLogger,
) => {
  const app = Fastify();
  app.get('/health', async (_request, reply) => {
    try {
      await readiness();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (!authorized(request.headers.authorization, token)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
  app.addHook('onError', (_request, _reply, error) => {
    logger.error({ err: error }, 'Maintenance API request failed');
    return Promise.resolve();
  });
  app.get('/maintenance/summary', async () => {
    const [agents, findings] = await Promise.all([
      store.agentNames(),
      store.listFindings({ status: 'OPEN', limit: 500 }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      agents: agents.map((name) => {
        const own = findings.filter((finding) => finding.agentName === name);
        const severity = own.some((finding) => finding.severity === 'CRITICAL')
          ? 'CRITICAL'
          : own.some((finding) => finding.severity === 'HIGH')
            ? 'HIGH'
            : own.some((finding) => finding.severity === 'MEDIUM')
              ? 'MEDIUM'
              : undefined;
        return {
          name,
          health: healthForSeverity(severity),
          openFindings: own.length,
        };
      }),
    };
  });
  app.get('/maintenance/findings', async (request, reply) => {
    const parsed = findingQuery.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'Invalid query', issues: parsed.error.issues });
    return store.listFindings({
      limit: parsed.data.limit,
      ...(parsed.data.agent ? { agent: parsed.data.agent } : {}),
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.since ? { since: new Date(parsed.data.since) } : {}),
    });
  });
  app.get('/maintenance/findings/:id', async (request, reply) => {
    const id = z.uuid().safeParse((request.params as { id?: unknown }).id);
    if (!id.success) return reply.code(400).send({ error: 'Invalid id' });
    return (
      (await store.finding(id.data)) ??
      reply.code(404).send({ error: 'Not found' })
    );
  });
  app.get('/maintenance/recommendations', async (request, reply) => {
    const parsed = recommendationQuery.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'Invalid query', issues: parsed.error.issues });
    return store.listRecommendations({
      limit: parsed.data.limit,
      ...(parsed.data.agent ? { agent: parsed.data.agent } : {}),
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.minConfidence === undefined
        ? {}
        : { minConfidence: parsed.data.minConfidence }),
    });
  });
  app.get('/maintenance/recommendations/:id', async (request, reply) => {
    const id = z.uuid().safeParse((request.params as { id?: unknown }).id);
    if (!id.success) return reply.code(400).send({ error: 'Invalid id' });
    return (
      (await store.recommendation(id.data)) ??
      reply.code(404).send({ error: 'Not found' })
    );
  });
  app.post('/maintenance/run', async (request, reply) => {
    const parsed = manualRunSchema.safeParse(request.body ?? {});
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'Invalid body', issues: parsed.error.issues });
    return engine.run('MANUAL', parsed.data.lookbackHours);
  });
  for (const [path, status] of [
    ['/maintenance/recommendations/:id/acknowledge', 'APPROVED'],
    ['/maintenance/recommendations/:id/reject', 'REJECTED'],
  ] as const) {
    app.post(path, async (request, reply) => {
      const id = z.uuid().safeParse((request.params as { id?: unknown }).id);
      if (!id.success) return reply.code(400).send({ error: 'Invalid id' });
      try {
        return await store.setRecommendationStatus(id.data, status);
      } catch {
        return reply.code(404).send({ error: 'Not found' });
      }
    });
  }
  app.get('/maintenance/briefing', async () => {
    const findings = await store.listFindings({ status: 'OPEN', limit: 100 });
    const rank: Record<string, number> = {
      CRITICAL: 5,
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      INFO: 1,
    };
    const important = findings
      .filter((finding) => (rank[finding.severity] ?? 0) >= 3)
      .sort(
        (a, b) =>
          (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0) ||
          b.confidence - a.confidence,
      )
      .slice(0, 10);
    return {
      generatedAt: new Date().toISOString(),
      health: important.some((finding) =>
        ['CRITICAL', 'HIGH'].includes(finding.severity),
      )
        ? 'critical'
        : important.length
          ? 'warning'
          : 'healthy',
      items: important.map((finding) => ({
        agent: finding.agentName,
        severity: finding.severity.toLowerCase(),
        problem: finding.title,
        recommendation: finding.recommendations[0]?.title,
        confidence: finding.confidence,
      })),
    };
  });
  return app;
};
