import { execFile } from 'node:child_process';
import {
  availableParallelism,
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
} from 'node:os';
import { readFile, readdir } from 'node:fs/promises';
import type { WatcherLogger } from '@watcher/core';
import type { MaintenanceStore } from '@watcher/database';

type CpuTimes = { idle: number; total: number };

export type GpuSnapshot = {
  name: string;
  utilizationPercent?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
};

export type SystemSnapshot = {
  observedAt: Date;
  platform: string;
  release: string;
  nodeVersion: string;
  uptimeSeconds: number;
  cpuModel: string;
  logicalCpuCount: number;
  cpuPercent?: number;
  loadAverage: [number, number, number];
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryPercent: number;
  gpus: GpuSnapshot[];
};

const cpuTimes = (): CpuTimes => {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
};

const command = (
  executable: string,
  args: string[],
): Promise<{ stdout: string }> =>
  new Promise((resolve, reject) => {
    execFile(executable, args, { timeout: 2_000 }, (error, stdout) => {
      if (error)
        reject(new Error('GPU metrics command failed', { cause: error }));
      else resolve({ stdout });
    });
  });

const toBytes = (mebibytes: number): number => mebibytes * 1024 * 1024;

const nvidiaGpus = async (executable: string): Promise<GpuSnapshot[]> => {
  const { stdout } = await command(executable, [
    '--query-gpu=name,utilization.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = 'NVIDIA GPU', utilization, used, total] = line
        .split(',')
        .map((value) => value.trim());
      return {
        name,
        ...(Number.isFinite(Number(utilization))
          ? { utilizationPercent: Number(utilization) }
          : {}),
        ...(Number.isFinite(Number(used))
          ? { memoryUsedBytes: toBytes(Number(used)) }
          : {}),
        ...(Number.isFinite(Number(total))
          ? { memoryTotalBytes: toBytes(Number(total)) }
          : {}),
      };
    });
};

const readNumber = async (path: string): Promise<number | undefined> => {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const amdGpus = async (): Promise<GpuSnapshot[]> => {
  try {
    const entries = await readdir('/sys/class/drm');
    const cards = entries.filter((entry) => /^card\d+$/u.test(entry));
    const results = await Promise.all(
      cards.map(async (card) => {
        const base = `/sys/class/drm/${card}/device`;
        const [utilizationPercent, memoryUsedBytes, memoryTotalBytes] =
          await Promise.all([
            readNumber(`${base}/gpu_busy_percent`),
            readNumber(`${base}/mem_info_vram_used`),
            readNumber(`${base}/mem_info_vram_total`),
          ]);
        if (
          utilizationPercent === undefined &&
          memoryTotalBytes === undefined
        ) {
          return undefined;
        }
        return {
          name: `AMD ${card}`,
          ...(utilizationPercent === undefined ? {} : { utilizationPercent }),
          ...(memoryUsedBytes === undefined ? {} : { memoryUsedBytes }),
          ...(memoryTotalBytes === undefined ? {} : { memoryTotalBytes }),
        };
      }),
    );
    return results.filter((gpu): gpu is GpuSnapshot => gpu !== undefined);
  } catch {
    return [];
  }
};

export class SystemMetricsSampler {
  #previousCpu: CpuTimes | undefined;

  public constructor(private readonly nvidiaSmiPath = 'nvidia-smi') {}

  public async sample(): Promise<SystemSnapshot> {
    const currentCpu = cpuTimes();
    const previousCpu = this.#previousCpu;
    this.#previousCpu = currentCpu;
    const totalDelta = previousCpu ? currentCpu.total - previousCpu.total : 0;
    const idleDelta = previousCpu ? currentCpu.idle - previousCpu.idle : 0;
    const constrained = process.constrainedMemory?.() ?? 0;
    const memoryTotalBytes = constrained > 0 ? constrained : totalmem();
    const available = process.availableMemory?.() ?? freemem();
    const memoryUsedBytes = Math.max(
      0,
      memoryTotalBytes - Math.min(memoryTotalBytes, available),
    );
    const gpus = await nvidiaGpus(this.nvidiaSmiPath).catch(() => amdGpus());
    const cpuList = cpus();
    return {
      observedAt: new Date(),
      platform: platform(),
      release: release(),
      nodeVersion: process.version,
      uptimeSeconds: process.uptime(),
      cpuModel: cpuList[0]?.model.trim() ?? 'unknown',
      logicalCpuCount: availableParallelism(),
      ...(totalDelta > 0
        ? {
            cpuPercent:
              Math.round((100 - (idleDelta / totalDelta) * 100) * 10) / 10,
          }
        : {}),
      loadAverage: loadavg() as [number, number, number],
      memoryUsedBytes,
      memoryTotalBytes,
      memoryPercent:
        Math.round((memoryUsedBytes / memoryTotalBytes) * 1_000) / 10,
      gpus,
    };
  }
}

type CapacityResource = 'CPU' | 'memory' | 'GPU';
type CapacityState = {
  consecutive: number;
  active: boolean;
  lastAlertAt?: Date;
};

export class CapacityEvaluator {
  readonly #states = new Map<CapacityResource, CapacityState>();

  public constructor(
    private readonly thresholds: Record<CapacityResource, number>,
    private readonly sustainedSamples: number,
    private readonly cooldownMs: number,
  ) {}

  public evaluate(
    snapshot: SystemSnapshot,
    now = snapshot.observedAt,
  ): Array<{ resource: CapacityResource; recovered: boolean; value: number }> {
    const gpuValues = snapshot.gpus.flatMap((gpu) => {
      const memoryPercent =
        gpu.memoryUsedBytes !== undefined && gpu.memoryTotalBytes
          ? (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100
          : undefined;
      return [gpu.utilizationPercent, memoryPercent].filter(
        (value): value is number => value !== undefined,
      );
    });
    const values: Array<[CapacityResource, number | undefined]> = [
      ['CPU', snapshot.cpuPercent],
      ['memory', snapshot.memoryPercent],
      ['GPU', gpuValues.length ? Math.max(...gpuValues) : undefined],
    ];
    const events: Array<{
      resource: CapacityResource;
      recovered: boolean;
      value: number;
    }> = [];
    for (const [resource, value] of values) {
      if (value === undefined) continue;
      const state = this.#states.get(resource) ?? {
        consecutive: 0,
        active: false,
      };
      const threshold = this.thresholds[resource];
      if (value >= threshold) {
        state.consecutive += 1;
        const cooldownElapsed =
          !state.lastAlertAt ||
          now.getTime() - state.lastAlertAt.getTime() >= this.cooldownMs;
        if (state.consecutive >= this.sustainedSamples && cooldownElapsed) {
          state.active = true;
          state.lastAlertAt = now;
          events.push({ resource, recovered: false, value });
        }
      } else {
        state.consecutive = 0;
        if (state.active && value <= Math.max(0, threshold - 10)) {
          state.active = false;
          events.push({ resource, recovered: true, value });
        }
      }
      this.#states.set(resource, state);
    }
    return events;
  }
}

const formatBytes = (bytes: number): string => {
  const gib = bytes / 1024 ** 3;
  return `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB`;
};

const percent = (value: number | undefined): string =>
  value === undefined ? 'unavailable' : `${value.toFixed(1)}%`;

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const renderSystemSnapshot = (snapshot: SystemSnapshot): string => {
  const gpu = snapshot.gpus.length
    ? snapshot.gpus
        .map((item) => {
          const memory =
            item.memoryUsedBytes !== undefined && item.memoryTotalBytes
              ? `${formatBytes(item.memoryUsedBytes)}/${formatBytes(item.memoryTotalBytes)}`
              : 'VRAM unavailable';
          return `${item.name}: ${percent(item.utilizationPercent)}, ${memory}`;
        })
        .join('; ')
    : 'unavailable (GPU is not exposed to this container)';
  return [
    `${snapshot.platform} ${snapshot.release} · Node ${snapshot.nodeVersion}`,
    `${snapshot.cpuModel} · ${snapshot.logicalCpuCount} logical CPUs · current ${percent(snapshot.cpuPercent)} · load ${snapshot.loadAverage.map((value) => value.toFixed(2)).join('/')}`,
    `RAM ${formatBytes(snapshot.memoryUsedBytes)}/${formatBytes(snapshot.memoryTotalBytes)} (${percent(snapshot.memoryPercent)})`,
    `GPU ${gpu}`,
  ].join('\n');
};

export const renderDebugRun = (
  run: Awaited<
    ReturnType<MaintenanceStore['listUndeliveredDebugRuns']>
  >[number],
  snapshot: SystemSnapshot,
): string => {
  const metadata = object(run.metadata);
  const resource = object(metadata?.resourceUsage);
  const cpuAverage = number(resource?.cpuAveragePercent);
  const cpuTimeMs = number(resource?.cpuTimeMs);
  const rssPeakBytes = number(resource?.rssPeakBytes);
  const heapPeakBytes = number(resource?.heapUsedPeakBytes);
  const failedSources = run.sources.filter(
    (source) => !['success', 'healthy'].includes(source.status.toLowerCase()),
  );
  return [
    `🔬 ${run.agentName} run`,
    `Status: ${run.status} · ${run.finishedAt?.toISOString() ?? 'unfinished'}`,
    `Duration: ${run.latencyMs === null ? 'unavailable' : `${run.latencyMs} ms`}`,
    `Items: fetched ${run.itemsFetched ?? '—'} · produced ${run.itemsProduced ?? '—'} · filtered ${run.itemsFiltered ?? '—'} · duplicates ${run.duplicatesRemoved ?? '—'}`,
    `Sources: ${run.sources.length} · failures ${failedSources.length}${
      failedSources.length
        ? ` (${failedSources
            .slice(0, 5)
            .map((source) => source.sourceId)
            .join(', ')})`
        : ''
    }`,
    `Run resources: CPU avg ${percent(cpuAverage)}${cpuTimeMs === undefined ? '' : ` · CPU time ${cpuTimeMs} ms`} · RSS peak ${rssPeakBytes === undefined ? 'unavailable' : formatBytes(rssPeakBytes)} · heap peak ${heapPeakBytes === undefined ? 'unavailable' : formatBytes(heapPeakBytes)}`,
    '',
    'Server snapshot:',
    renderSystemSnapshot(snapshot),
  ].join('\n');
};

export class MaintenanceRuntimeMonitor {
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  public constructor(
    private readonly store: MaintenanceStore,
    private readonly sampler: SystemMetricsSampler,
    private readonly evaluator: CapacityEvaluator,
    private readonly intervalMs: number,
    private readonly notifyCapacity: (message: string) => Promise<void>,
    private readonly notifyChat: (
      chatId: bigint,
      message: string,
    ) => Promise<void>,
    private readonly logger: WatcherLogger,
  ) {}

  public start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.intervalMs);
    this.#timer.unref();
    void this.tick();
  }

  public async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  public snapshot(): Promise<SystemSnapshot> {
    return this.sampler.sample();
  }

  private tick(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.executeTick().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  private async executeTick(): Promise<void> {
    try {
      const snapshot = await this.sampler.sample();
      for (const event of this.evaluator.evaluate(snapshot)) {
        const message = event.recovered
          ? `✅ Server ${event.resource} recovered to ${event.value.toFixed(1)}%.`
          : `🚨 Server capacity warning: ${event.resource} is at ${event.value.toFixed(1)}%.\n\n${renderSystemSnapshot(snapshot)}`;
        await this.notifyCapacity(message);
      }
      for (const subscription of await this.store.listDebugSubscriptions()) {
        if (!subscription.enabledAt) continue;
        const runs = await this.store.listUndeliveredDebugRuns(
          subscription.chatId,
          subscription.enabledAt,
        );
        for (const run of runs) {
          await this.notifyChat(
            subscription.chatId,
            renderDebugRun(run, snapshot),
          );
          await this.store.markDebugRunDelivered(subscription.chatId, run.id);
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error },
        'Maintenance runtime monitor tick failed',
      );
    }
  }
}
