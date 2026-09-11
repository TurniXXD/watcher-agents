import { describe, expect, it, vi } from 'vitest';
import type { MaintenanceStore } from '@watcher/database';
import {
  AgentStatusService,
  renderAgentStatus,
  type AgentLiveStatus,
} from '../agent-status.js';

const now = new Date('2026-09-11T12:00:00Z');

const run = (
  input: {
    status?: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    startedAt?: Date;
    finishedAt?: Date;
    error?: unknown;
    sources?: { sourceId: string; error: string | null }[];
  } = {},
) =>
  ({
    id: 'run-1',
    agentName: 'stocks-bot',
    startedAt: input.startedAt ?? new Date('2026-09-11T11:00:00Z'),
    finishedAt: input.finishedAt ?? new Date('2026-09-11T11:01:00Z'),
    status: input.status ?? 'SUCCESS',
    error: input.error ?? null,
    sources: input.sources ?? [],
  }) as NonNullable<AgentLiveStatus['latestRun']>;

const status = (input: Partial<AgentLiveStatus> = {}): AgentLiveStatus => ({
  agentName: 'stocks-bot',
  latestRun: run(),
  recentErrorRuns: [],
  probe: { status: 'healthy', latencyMs: 12 },
  ...input,
});

describe('agent status reporting', () => {
  it('reports a ready agent with fresh successful telemetry as running', () => {
    const report = renderAgentStatus(
      [status()],
      now,
      26 * 3_600_000,
      24 * 3_600_000,
    );

    expect(report).toContain('🟢 stocks-bot — RUNNING');
    expect(report).toContain('health OK (12 ms) · last run SUCCESS 59m ago');
    expect(report).toContain('No recorded errors in the last 24h.');
  });

  it('reports stale telemetry even when the live endpoint is ready', () => {
    const oldRun = run({
      startedAt: new Date('2026-09-09T07:00:00Z'),
      finishedAt: new Date('2026-09-09T07:01:00Z'),
    });
    const report = renderAgentStatus(
      [status({ latestRun: oldRun })],
      now,
      26 * 3_600_000,
      24 * 3_600_000,
    );

    expect(report).toContain('🟡 stocks-bot — STALE');
    expect(report).toContain('last run SUCCESS 2d ago');
  });

  it('shows recent recorded errors without exposing URLs or credentials', () => {
    const failedRun = run({
      status: 'FAILED',
      error: {
        message:
          'POST https://user:secret@example.test failed authorization=abc',
      },
      sources: [
        {
          sourceId: 'SEC',
          error: 'Bearer private-token was rejected',
        },
      ],
    });
    const report = renderAgentStatus(
      [
        status({
          latestRun: failedRun,
          recentErrorRuns: [failedRun],
        }),
      ],
      now,
      26 * 3_600_000,
      24 * 3_600_000,
    );

    expect(report).toContain('🟠 stocks-bot — DEGRADED');
    expect(report).toContain('POST [URL] failed authorization=[REDACTED]');
    expect(report).toContain('SEC: Bearer [REDACTED] was rejected');
    expect(report).not.toContain('private-token');
    expect(report).not.toContain('user:secret');
  });

  it('uses live health probes and the configured error lookback', async () => {
    const agentStatuses = vi.fn(async () => [
      {
        agentName: 'stocks-bot',
        latestRun: run(),
        recentErrorRuns: [],
      },
    ]);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    const service = new AgentStatusService(
      { agentStatuses } as unknown as MaintenanceStore,
      26 * 3_600_000,
      24 * 3_600_000,
      [{ agentName: 'stocks-bot', url: 'http://stocks-bot:8080/healthz' }],
      fetcher,
      () => now,
    );

    const report = await service.report();

    expect(report).toContain('🔴 stocks-bot — UNHEALTHY');
    expect(report).toContain('health HTTP 503');
    expect(agentStatuses).toHaveBeenCalledWith(
      ['stocks-bot'],
      new Date('2026-09-10T12:00:00Z'),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://stocks-bot:8080/healthz');
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
