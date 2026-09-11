import { describe, expect, it, vi } from 'vitest';
import { AgentTelemetryStore } from '../agent-telemetry-store.js';
import type { DatabaseClient } from '../client.js';

describe('AgentTelemetryStore', () => {
  it('preserves the observed run time when refreshing source telemetry', async () => {
    type UpsertInput = {
      create: { sources: { create: Array<{ createdAt: Date }> } };
      update: { sources: { create: Array<{ createdAt: Date }> } };
    };
    const upsert = vi.fn<(input: UpsertInput) => Promise<{ id: string }>>(
      async () => ({ id: 'run-1' }),
    );
    const database = { agentRun: { upsert } } as unknown as DatabaseClient;
    const startedAt = new Date('2026-09-08T05:00:00Z');
    const finishedAt = new Date('2026-09-08T05:02:00Z');

    await new AgentTelemetryStore(database).recordRun({
      id: 'run-1',
      agentName: 'fixture-agent',
      startedAt,
      finishedAt,
      status: 'success',
      sources: [{ sourceId: 'rss', status: 'success', itemCount: 2 }],
    });

    const input = upsert.mock.calls[0]?.[0];
    expect(input?.create.sources.create.at(0)?.createdAt).toEqual(finishedAt);
    expect(input?.update.sources.create.at(0)?.createdAt).toEqual(finishedAt);
  });
});
