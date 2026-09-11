import type { MaintenanceStore } from '@watcher/database';

export type AgentHealthTarget = {
  agentName: string;
  url: string;
};

export const defaultAgentHealthTargets: readonly AgentHealthTarget[] = [
  { agentName: 'stocks-bot', url: 'http://stocks-bot:8080/healthz' },
  {
    agentName: 'publications-bot',
    url: 'http://publications-bot:8080/healthz',
  },
  { agentName: 'news-bot', url: 'http://news-bot:8080/healthz' },
  {
    agentName: 'mu-clubs-monitor',
    url: 'http://mu-clubs-monitor:4010/healthz',
  },
  {
    agentName: 'brno-events-agent',
    url: 'http://brno-events-agent:4020/health',
  },
  { agentName: 'briefing-bot', url: 'http://briefing-bot:8080/healthz' },
];

type ProbeResult =
  | { status: 'healthy'; latencyMs: number }
  | { status: 'unhealthy'; latencyMs: number; detail: string }
  | { status: 'unreachable'; latencyMs: number };

type StatusData = Awaited<
  ReturnType<MaintenanceStore['agentStatuses']>
>[number];

export type AgentLiveStatus = StatusData & {
  probe: ProbeResult;
};

const probe = async (
  target: AgentHealthTarget,
  fetcher: typeof fetch,
): Promise<ProbeResult> => {
  const startedAt = performance.now();
  try {
    const response = await fetcher(target.url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    return response.ok
      ? { status: 'healthy', latencyMs }
      : {
          status: 'unhealthy',
          latencyMs,
          detail: `HTTP ${response.status}`,
        };
  } catch {
    return {
      status: 'unreachable',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
};

const age = (observedAt: Date, now: Date): string => {
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - observedAt.getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (24 * 60))}d ago`;
};

const safeError = (value: string): string =>
  value
    .replace(/https?:\/\/\S+/giu, '[URL]')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(token|password|secret|api[_-]?key|authorization)\s*[=:]\s*\S+/giu,
      '$1=[REDACTED]',
    )
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 220);

const runError = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const message = (value as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim()
    ? safeError(message)
    : undefined;
};

const recentErrors = (status: AgentLiveStatus, now: Date): string[] => {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const run of status.recentErrorRuns) {
    const observedAt = run.finishedAt ?? run.startedAt;
    const recordedRunError = runError(run.error);
    const errors = [
      ...(recordedRunError ? [`run: ${recordedRunError}`] : []),
      ...run.sources.flatMap((source) =>
        source.error ? [`${source.sourceId}: ${safeError(source.error)}`] : [],
      ),
      ...(run.status !== 'SUCCESS' && !recordedRunError && !run.sources.length
        ? [`run ended as ${run.status}`]
        : []),
    ];
    for (const error of errors) {
      if (seen.has(error)) continue;
      seen.add(error);
      entries.push(`${age(observedAt, now)} — ${error}`);
      if (entries.length === 2) return entries;
    }
  }
  return entries;
};

const state = (
  status: AgentLiveStatus,
  now: Date,
  staleAfterMs: number,
): { icon: string; label: string } => {
  if (status.probe.status === 'unreachable')
    return { icon: '🔴', label: 'DOWN' };
  if (status.probe.status === 'unhealthy')
    return { icon: '🔴', label: 'UNHEALTHY' };
  const lastObservedAt =
    status.latestRun?.finishedAt ?? status.latestRun?.startedAt;
  if (
    !lastObservedAt ||
    now.getTime() - lastObservedAt.getTime() > staleAfterMs
  )
    return { icon: '🟡', label: 'STALE' };
  if (status.latestRun?.status !== 'SUCCESS')
    return { icon: '🟠', label: 'DEGRADED' };
  return { icon: '🟢', label: 'RUNNING' };
};

export const renderAgentStatus = (
  statuses: readonly AgentLiveStatus[],
  now: Date,
  staleAfterMs: number,
  errorLookbackMs: number,
): string => {
  const sections = statuses.map((status) => {
    const current = state(status, now, staleAfterMs);
    const latest = status.latestRun;
    const lastObservedAt = latest?.finishedAt ?? latest?.startedAt;
    const health =
      status.probe.status === 'healthy'
        ? `health OK (${status.probe.latencyMs} ms)`
        : status.probe.status === 'unhealthy'
          ? `health ${status.probe.detail} (${status.probe.latencyMs} ms)`
          : `health unreachable (${status.probe.latencyMs} ms)`;
    const errors = recentErrors(status, now);
    return [
      `${current.icon} ${status.agentName} — ${current.label}`,
      `  ${health} · last run ${latest ? `${latest.status} ${age(lastObservedAt!, now)}` : 'never recorded'}`,
      ...(errors.length
        ? errors.map((error) => `  ⚠️ ${error}`)
        : [
            `  No recorded errors in the last ${Math.round(errorLookbackMs / 3_600_000)}h.`,
          ]),
    ].join('\n');
  });
  return [
    '📡 Live agent status',
    `Checked ${now.toISOString()}`,
    '',
    ...sections.flatMap((section) => [section, '']),
    'RUNNING means the live health endpoint is ready. STALE means the process is ready but its last recorded run is too old.',
  ].join('\n');
};

export class AgentStatusService {
  public constructor(
    private readonly store: MaintenanceStore,
    private readonly staleAfterMs: number,
    private readonly errorLookbackMs: number,
    private readonly targets: readonly AgentHealthTarget[] = defaultAgentHealthTargets,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async report(): Promise<string> {
    const now = this.now();
    const agentNames = this.targets.map((target) => target.agentName);
    const [data, probes] = await Promise.all([
      this.store.agentStatuses(
        agentNames,
        new Date(now.getTime() - this.errorLookbackMs),
      ),
      Promise.all(this.targets.map((target) => probe(target, this.fetcher))),
    ]);
    const byAgent = new Map(data.map((entry) => [entry.agentName, entry]));
    const statuses = this.targets.map((target, index): AgentLiveStatus => {
      const entry = byAgent.get(target.agentName);
      const targetProbe = probes[index];
      if (!entry || !targetProbe)
        throw new Error(`Missing status data for ${target.agentName}`);
      return { ...entry, probe: targetProbe };
    });
    return renderAgentStatus(
      statuses,
      now,
      this.staleAfterMs,
      this.errorLookbackMs,
    );
  }
}
