import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { PostgresOllamaCoordinator } from '../ollama-coordinator-store.js';
import { ResourceLeaseStore } from '../resource-lease-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('PostgresOllamaCoordinator', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);
  const context = {
    caller: 'news-bot',
    model: 'qwen3',
    operation: 'chat' as const,
    priority: 'normal' as const,
    timeoutMs: 5_000,
  };

  beforeEach(async () => {
    await database.ollamaRequest.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('serializes and prioritizes requests across coordinator instances', async () => {
    const firstCoordinator = new PostgresOllamaCoordinator(
      database,
      undefined,
      {
        pollIntervalMs: 5,
      },
    );
    const secondCoordinator = new PostgresOllamaCoordinator(
      database,
      undefined,
      {
        pollIntervalMs: 5,
      },
    );
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const order: string[] = [];
    const first = firstCoordinator.run(context, async () => {
      order.push('first-start');
      markStarted?.();
      await waiting;
      order.push('first-end');
    });
    await started;
    const normal = secondCoordinator.run(context, async () => {
      order.push('normal');
    });
    const high = firstCoordinator.run(
      { ...context, caller: 'briefing-bot', priority: 'high' },
      async () => {
        order.push('high');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order).toEqual(['first-start']);
    release?.();
    await Promise.all([first, normal, high]);
    expect(order).toEqual(['first-start', 'first-end', 'high', 'normal']);
    expect(await firstCoordinator.snapshot()).toMatchObject({
      active: [],
      queued: [],
    });
  });

  it('shares the hardware lease with speech generation', async () => {
    const resources = new ResourceLeaseStore(database);
    const coordinator = new PostgresOllamaCoordinator(database, undefined, {
      pollIntervalMs: 5,
    });
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const order: string[] = [];
    const analysis = coordinator.run(context, async () => {
      order.push('analysis-start');
      markStarted?.();
      await waiting;
      order.push('analysis-end');
    });
    await started;
    const speech = resources.withExclusiveLease(
      'HEAVY_LOCAL_MODEL',
      async () => {
        order.push('speech');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order).toEqual(['analysis-start']);
    release?.();
    await Promise.all([analysis, speech]);
    expect(order).toEqual(['analysis-start', 'analysis-end', 'speech']);
  });

  it('releases the lock when an inference fails', async () => {
    const coordinator = new PostgresOllamaCoordinator(database, undefined, {
      pollIntervalMs: 5,
    });
    await expect(
      coordinator.run(context, () =>
        Promise.reject(new Error('inference failed')),
      ),
    ).rejects.toThrow('inference failed');
    await expect(
      coordinator.run(context, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });

  it('releases the lock when an inference times out', async () => {
    const coordinator = new PostgresOllamaCoordinator(database, undefined, {
      pollIntervalMs: 5,
      leaseGraceMs: 250,
    });
    await expect(
      coordinator.run(
        { ...context, timeoutMs: 50 },
        () => new Promise(() => undefined),
      ),
    ).rejects.toThrow('timed out after 50 ms');
    await expect(
      coordinator.run({ ...context, timeoutMs: 1_000 }, () =>
        Promise.resolve('released'),
      ),
    ).resolves.toBe('released');
  });

  it('expires stale active request telemetry', async () => {
    const expiredAt = new Date('2026-09-10T12:00:00Z');
    await database.ollamaRequest.create({
      data: {
        caller: 'news-bot',
        model: 'qwen3',
        operation: 'chat',
        priority: 1,
        status: 'ACTIVE',
        queuedAt: new Date(expiredAt.getTime() - 10_000),
        queueExpiresAt: new Date(expiredAt.getTime() + 60_000),
        startedAt: new Date(expiredAt.getTime() - 5_000),
        leaseExpiresAt: expiredAt,
        timeoutMs: 5_000,
      },
    });
    const coordinator = new PostgresOllamaCoordinator(database);

    expect(
      await coordinator.snapshot(new Date(expiredAt.getTime() + 1)),
    ).toMatchObject({ active: [] });
    expect(
      await database.ollamaRequest.findFirst({ select: { status: true } }),
    ).toEqual({ status: 'TIMED_OUT' });
  });
});
