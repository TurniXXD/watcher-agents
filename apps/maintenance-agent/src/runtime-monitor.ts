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

export type ProcessSnapshot = {
  pid: number;
  name: string;
  cpuPercent?: number;
  memoryBytes: number;
  memoryPercent: number;
  gpuMemoryBytes?: number;
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
  processes: ProcessSnapshot[];
};

type ProcessCpuTimes = { total: number; processes: Map<number, number> };

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

const nvidiaGpus = async (
  executable: string,
): Promise<{ gpus: GpuSnapshot[]; gpuProcesses: Map<number, number> }> => {
  const { stdout } = await command(executable, [
    '--query-gpu=name,utilization.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  const gpus = stdout
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
  const gpuProcesses = new Map<number, number>();
  try {
    const result = await command(executable, [
      '--query-compute-apps=pid,used_gpu_memory',
      '--format=csv,noheader,nounits',
    ]);
    for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
      const [rawPid, rawMemory] = line.split(',').map((value) => value.trim());
      const pid = Number(rawPid);
      const memory = Number(rawMemory);
      if (Number.isInteger(pid) && Number.isFinite(memory))
        gpuProcesses.set(pid, toBytes(memory));
    }
  } catch {
    // Per-process GPU metrics are optional; device metrics remain useful.
  }
  return { gpus, gpuProcesses };
};

const readNumber = async (path: string): Promise<number | undefined> => {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const gpuVendor = (value: number | undefined): string => {
  if (value === 0x1002) return 'AMD';
  if (value === 0x10de) return 'NVIDIA';
  if (value === 0x8086) return 'Intel';
  return 'DRM';
};

const drmGpus = async (root: string): Promise<GpuSnapshot[]> => {
  try {
    const entries = await readdir(root);
    const cards = entries.filter((entry) => /^card\d+$/u.test(entry));
    const results = await Promise.all(
      cards.map(async (card) => {
        const base = `${root}/${card}/device`;
        const [vendor, utilizationPercent, memoryUsedBytes, memoryTotalBytes] =
          await Promise.all([
            readNumber(`${base}/vendor`),
            readNumber(`${base}/gpu_busy_percent`),
            readNumber(`${base}/mem_info_vram_used`),
            readNumber(`${base}/mem_info_vram_total`),
          ]);
        if (
          vendor === undefined &&
          utilizationPercent === undefined &&
          memoryTotalBytes === undefined
        ) {
          return undefined;
        }
        return {
          name: `${gpuVendor(vendor)} ${card}`,
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

const procMemory = async (
  root: string,
): Promise<{ total: number; used: number } | undefined> => {
  try {
    const text = await readFile(`${root}/meminfo`, 'utf8');
    const values = new Map<string, number>();
    for (const line of text.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB$/u);
      if (match?.[1] && match[2]) values.set(match[1], Number(match[2]) * 1024);
    }
    const total = values.get('MemTotal');
    const available = values.get('MemAvailable');
    if (!total || available === undefined) return undefined;
    return { total, used: Math.max(0, total - Math.min(total, available)) };
  } catch {
    return undefined;
  }
};

const processName = (commandName: string, commandLine: string): string => {
  const args = commandLine.split('\0').filter(Boolean);
  const applicationScript = args[1]?.match(
    /^\/app\/(apps\/[\p{L}\p{N}._/-]+)$/u,
  )?.[1];
  if (commandName === 'node' && applicationScript)
    return `node ${applicationScript}`.slice(0, 100);
  return commandName.replace(/[^\p{L}\p{N}._/ -]/gu, '').slice(0, 100);
};

const processCpuTimes = async (root: string): Promise<ProcessCpuTimes> => {
  const system = (await readFile(`${root}/stat`, 'utf8')).split('\n')[0];
  const total = (system?.match(/^cpu\s+(.+)$/u)?.[1] ?? '')
    .split(/\s+/u)
    .reduce((sum, value) => sum + (Number(value) || 0), 0);
  const processes = new Map<number, number>();
  const entries = await readdir(root);
  await Promise.all(
    entries
      .filter((entry) => /^\d+$/u.test(entry))
      .map(async (entry) => {
        try {
          const stat = await readFile(`${root}/${entry}/stat`, 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/u);
          const ticks = Number(fields[11]) + Number(fields[12]);
          const pid = Number(entry);
          if (Number.isFinite(ticks)) processes.set(pid, ticks);
        } catch {
          // Processes can exit while /proc is being sampled.
        }
      }),
  );
  return { total, processes };
};

const processes = async (
  root: string,
  memoryTotalBytes: number,
  previous: ProcessCpuTimes | undefined,
  logicalCpuCount: number,
  gpuProcesses: ReadonlyMap<number, number>,
): Promise<{ current: ProcessCpuTimes; rows: ProcessSnapshot[] }> => {
  const current = await processCpuTimes(root);
  const totalDelta = previous ? current.total - previous.total : 0;
  const rows = await Promise.all(
    [...current.processes.entries()].map(async ([pid, ticks]) => {
      try {
        const [comm, commandLine, status] = await Promise.all([
          readFile(`${root}/${pid}/comm`, 'utf8'),
          readFile(`${root}/${pid}/cmdline`, 'utf8').catch(() => ''),
          readFile(`${root}/${pid}/status`, 'utf8'),
        ]);
        const memoryBytes =
          Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/mu)?.[1] ?? 0) * 1024;
        const previousTicks = previous?.processes.get(pid);
        const cpuPercent =
          previousTicks !== undefined && totalDelta > 0
            ? Math.max(
                0,
                ((ticks - previousTicks) / totalDelta) * logicalCpuCount * 100,
              )
            : undefined;
        return {
          pid,
          name: processName(comm.trim(), commandLine),
          ...(cpuPercent === undefined ? {} : { cpuPercent }),
          memoryBytes,
          memoryPercent:
            memoryTotalBytes > 0 ? (memoryBytes / memoryTotalBytes) * 100 : 0,
          ...(gpuProcesses.has(pid)
            ? { gpuMemoryBytes: gpuProcesses.get(pid)! }
            : {}),
        };
      } catch {
        return undefined;
      }
    }),
  );
  return {
    current,
    rows: rows.filter((row): row is ProcessSnapshot => row !== undefined),
  };
};

export class SystemMetricsSampler {
  #previousCpu: CpuTimes | undefined;
  #previousProcessCpu: ProcessCpuTimes | undefined;

  public constructor(
    private readonly nvidiaSmiPath = 'nvidia-smi',
    private readonly hostProcRoot = '/host/proc',
    private readonly hostDrmRoot = '/host/sys/class/drm',
  ) {}

  public async sample(): Promise<SystemSnapshot> {
    const currentCpu = cpuTimes();
    const previousCpu = this.#previousCpu;
    this.#previousCpu = currentCpu;
    const totalDelta = previousCpu ? currentCpu.total - previousCpu.total : 0;
    const idleDelta = previousCpu ? currentCpu.idle - previousCpu.idle : 0;
    const cpuList = cpus();
    const logicalCpuCount = availableParallelism();
    const procRoot = await readFile(`${this.hostProcRoot}/stat`, 'utf8')
      .then(() => this.hostProcRoot)
      .catch(() => '/proc');
    const memory = (await procMemory(procRoot)) ?? {
      total: totalmem(),
      used: Math.max(0, totalmem() - freemem()),
    };
    const gpu = await nvidiaGpus(this.nvidiaSmiPath).catch(async () => ({
      gpus: await drmGpus(this.hostDrmRoot).then((items) =>
        items.length ? items : drmGpus('/sys/class/drm'),
      ),
      gpuProcesses: new Map<number, number>(),
    }));
    const sampledProcesses = await processes(
      procRoot,
      memory.total,
      this.#previousProcessCpu,
      logicalCpuCount,
      gpu.gpuProcesses,
    ).catch(() => ({
      current: undefined,
      rows: [] as ProcessSnapshot[],
    }));
    this.#previousProcessCpu = sampledProcesses.current;
    return {
      observedAt: new Date(),
      platform: platform(),
      release: release(),
      nodeVersion: process.version,
      uptimeSeconds: process.uptime(),
      cpuModel: cpuList[0]?.model.trim() ?? 'unknown',
      logicalCpuCount,
      ...(totalDelta > 0
        ? {
            cpuPercent:
              Math.round((100 - (idleDelta / totalDelta) * 100) * 10) / 10,
          }
        : {}),
      loadAverage: loadavg() as [number, number, number],
      memoryUsedBytes: memory.used,
      memoryTotalBytes: memory.total,
      memoryPercent: Math.round((memory.used / memory.total) * 1_000) / 10,
      gpus: gpu.gpus,
      processes: sampledProcesses.rows,
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

export const renderTopProcesses = (
  snapshot: SystemSnapshot,
  resource: CapacityResource,
): string => {
  const ranked = [...snapshot.processes]
    .filter((item) =>
      resource === 'GPU'
        ? item.gpuMemoryBytes !== undefined
        : resource === 'CPU'
          ? item.cpuPercent !== undefined
          : item.memoryBytes > 0,
    )
    .sort((left, right) => {
      if (resource === 'GPU')
        return (right.gpuMemoryBytes ?? 0) - (left.gpuMemoryBytes ?? 0);
      if (resource === 'CPU')
        return (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0);
      return right.memoryBytes - left.memoryBytes;
    })
    .slice(0, 5);
  if (!ranked.length)
    return `Top ${resource} processes: unavailable from the host process view.`;
  return [
    `Top ${resource} processes:`,
    ...ranked.map((item) => {
      const usage =
        resource === 'GPU'
          ? `${formatBytes(item.gpuMemoryBytes ?? 0)} VRAM`
          : resource === 'CPU'
            ? `${percent(item.cpuPercent)} CPU`
            : `${formatBytes(item.memoryBytes)} RAM (${percent(item.memoryPercent)})`;
      return `• ${item.name} (PID ${item.pid}) — ${usage}`;
    }),
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
          : `🚨 Server capacity warning: ${event.resource} is at ${event.value.toFixed(1)}%.\n\n${renderSystemSnapshot(snapshot)}\n\n${renderTopProcesses(snapshot, event.resource)}`;
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
