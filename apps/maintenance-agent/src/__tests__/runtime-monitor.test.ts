import { describe, expect, it } from 'vitest';
import {
  CapacityEvaluator,
  OllamaAnomalyEvaluator,
  ollamaUsageSnapshot,
  renderOllamaAnomaly,
  renderTopProcesses,
  renderSystemSnapshot,
  type OllamaAnomalySettings,
  type OllamaUsageSnapshot,
  type SystemSnapshot,
} from '../runtime-monitor.js';

const snapshot = (input: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  observedAt: new Date('2026-09-10T12:00:00Z'),
  platform: 'linux',
  release: '6.8.0',
  nodeVersion: 'v26.3.0',
  uptimeSeconds: 60,
  cpuModel: 'Test CPU',
  logicalCpuCount: 8,
  cpuPercent: 95,
  loadAverage: [7, 6, 5],
  memoryUsedBytes: 8 * 1024 ** 3,
  memoryTotalBytes: 16 * 1024 ** 3,
  memoryPercent: 50,
  gpus: [],
  processes: [],
  ...input,
});

const anomalySettings: OllamaAnomalySettings = {
  cpuAlertPercent: 150,
  highUsageDurationMs: 60_000,
  imbalanceEnabled: true,
  imbalanceDurationMs: 60_000,
  cpuGpuShareMarginPercent: 20,
  gpuLowUtilPercent: 20,
  requestTimeoutMs: 300_000,
  queueAlertSize: 10,
  queueWaitAlertMs: 180_000,
  cooldownMs: 300_000,
};

const ollamaSnapshot = (
  input: Partial<OllamaUsageSnapshot> = {},
): OllamaUsageSnapshot => ({
  observedAt: new Date('2026-09-10T12:00:00Z'),
  queue: {
    observedAt: new Date('2026-09-10T12:00:00Z'),
    active: [],
    queued: [],
  },
  models: [],
  ...input,
});

describe('maintenance runtime monitoring', () => {
  it('warns only after sustained capacity and applies cooldown', () => {
    const evaluator = new CapacityEvaluator(
      { CPU: 90, memory: 90, GPU: 90 },
      3,
      30 * 60_000,
    );
    const first = snapshot();
    expect(evaluator.evaluate(first)).toEqual([]);
    expect(
      evaluator.evaluate(
        snapshot({ observedAt: new Date(first.observedAt.getTime() + 30_000) }),
      ),
    ).toEqual([]);
    expect(
      evaluator.evaluate(
        snapshot({ observedAt: new Date(first.observedAt.getTime() + 60_000) }),
      ),
    ).toEqual([{ resource: 'CPU', recovered: false, value: 95 }]);
    expect(
      evaluator.evaluate(
        snapshot({ observedAt: new Date(first.observedAt.getTime() + 90_000) }),
      ),
    ).toEqual([]);
  });

  it('uses GPU utilization or VRAM and sends recovery after hysteresis', () => {
    const evaluator = new CapacityEvaluator(
      { CPU: 90, memory: 90, GPU: 90 },
      1,
      60_000,
    );
    const high = snapshot({
      cpuPercent: 10,
      gpus: [
        {
          name: 'GPU',
          utilizationPercent: 20,
          memoryUsedBytes: 95,
          memoryTotalBytes: 100,
        },
      ],
    });
    expect(evaluator.evaluate(high)).toEqual([
      { resource: 'GPU', recovered: false, value: 95 },
    ]);
    expect(
      evaluator.evaluate(
        snapshot({
          observedAt: new Date(high.observedAt.getTime() + 30_000),
          cpuPercent: 10,
          gpus: [{ name: 'GPU', utilizationPercent: 70 }],
        }),
      ),
    ).toEqual([{ resource: 'GPU', recovered: true, value: 70 }]);
  });

  it('marks GPU unavailable instead of inventing telemetry', () => {
    const report = renderSystemSnapshot(snapshot());
    expect(report).toContain('RAM 8.00 GiB/16.0 GiB (50.0%)');
    expect(report).toContain(
      'GPU unavailable (GPU is not exposed to this container)',
    );
  });

  it('reports a DRM-detected GPU even when utilization counters are absent', () => {
    expect(
      renderSystemSnapshot(snapshot({ gpus: [{ name: 'Intel card0' }] })),
    ).toContain('GPU Intel card0: unavailable, VRAM unavailable');
  });

  it('shows the processes consuming the alerted resource', () => {
    const value = snapshot({
      processes: [
        {
          pid: 42,
          name: 'node apps/publications-bot/dist/index.js',
          cpuPercent: 72.4,
          memoryBytes: 5 * 1024 ** 3,
          memoryPercent: 31.25,
        },
        {
          pid: 43,
          name: 'ollama',
          cpuPercent: 15,
          memoryBytes: 7 * 1024 ** 3,
          memoryPercent: 43.75,
          gpuMemoryBytes: 6 * 1024 ** 3,
        },
      ],
    });

    expect(renderTopProcesses(value, 'memory')).toContain(
      'ollama (PID 43) — 7.00 GiB RAM (43.8%)',
    );
    expect(renderTopProcesses(value, 'CPU')).toContain(
      'publications-bot/dist/index.js (PID 42) — 72.4% CPU',
    );
    expect(renderTopProcesses(value, 'GPU')).toContain(
      'ollama (PID 43) — 6.00 GiB VRAM',
    );
  });

  it('alerts immediately when instrumentation reports multiple active inferences', () => {
    const evaluator = new OllamaAnomalyEvaluator(anomalySettings);
    const observedAt = new Date('2026-09-10T12:00:00Z');
    const value = ollamaSnapshot({
      observedAt,
      queue: {
        observedAt,
        active: ['news-bot', 'stocks-bot'].map((caller, index) => ({
          id: String(index),
          caller,
          model: 'qwen3',
          operation: 'chat' as const,
          startedAt: new Date(observedAt.getTime() - 10_000),
          leaseExpiresAt: new Date(observedAt.getTime() + 60_000),
          timeoutMs: 120_000,
        })),
        queued: [],
      },
    });
    const [event] = evaluator.evaluate(value);

    expect(event).toEqual({ recovered: false, reasons: ['multiple-active'] });
    expect(renderOllamaAnomaly(value, event!)).toContain('Active requests: 2');
  });

  it('alerts for sustained Ollama CPU but ignores a short spike', () => {
    const evaluator = new OllamaAnomalyEvaluator(anomalySettings);
    const startedAt = new Date('2026-09-10T11:59:00Z');
    const active = {
      id: 'one',
      caller: 'news-bot',
      model: 'qwen3',
      operation: 'chat' as const,
      startedAt,
      leaseExpiresAt: new Date('2026-09-10T12:10:00Z'),
      timeoutMs: 120_000,
    };
    expect(
      evaluator.evaluate(
        ollamaSnapshot({
          cpuPercent: 200,
          queue: {
            observedAt: new Date('2026-09-10T12:00:00Z'),
            active: [active],
            queued: [],
          },
        }),
      ),
    ).toEqual([]);
    expect(
      evaluator.evaluate(
        ollamaSnapshot({
          observedAt: new Date('2026-09-10T12:00:30Z'),
          cpuPercent: 20,
          queue: {
            observedAt: new Date('2026-09-10T12:00:30Z'),
            active: [active],
            queued: [],
          },
        }),
      ),
    ).toEqual([]);

    const sustained = new OllamaAnomalyEvaluator(anomalySettings);
    const first = ollamaSnapshot({
      cpuPercent: 200,
      queue: {
        observedAt: new Date('2026-09-10T12:00:00Z'),
        active: [active],
        queued: [],
      },
    });
    expect(sustained.evaluate(first)).toEqual([]);
    expect(
      sustained.evaluate({
        ...first,
        observedAt: new Date('2026-09-10T12:01:00Z'),
      }),
    ).toEqual([{ recovered: false, reasons: ['high-cpu'] }]);
  });

  it('detects sustained CPU/GPU imbalance only while an inference is active', () => {
    const evaluator = new OllamaAnomalyEvaluator(anomalySettings);
    const observedAt = new Date('2026-09-10T12:00:00Z');
    const active = {
      id: 'one',
      caller: 'briefing-bot',
      model: 'qwen3',
      operation: 'chat' as const,
      startedAt: observedAt,
      leaseExpiresAt: new Date(observedAt.getTime() + 300_000),
      timeoutMs: 300_000,
    };
    const first = ollamaSnapshot({
      observedAt,
      cpuSharePercent: 80,
      gpuSharePercent: 20,
      queue: { observedAt, active: [active], queued: [] },
    });
    expect(evaluator.evaluate(first)).toEqual([]);
    expect(
      evaluator.evaluate({
        ...first,
        observedAt: new Date(observedAt.getTime() + 60_000),
      }),
    ).toEqual([{ recovered: false, reasons: ['cpu-gpu-imbalance'] }]);
  });

  it('does not treat an idle loaded model or keep-alive socket as active inference', () => {
    const idle = new OllamaAnomalyEvaluator(anomalySettings);
    expect(
      idle.evaluate(
        ollamaSnapshot({
          cpuPercent: 300,
          cpuSharePercent: 100,
          gpuSharePercent: 0,
          models: [{ model: 'qwen3', sizeBytes: 100, vramBytes: 0 }],
        }),
      ),
    ).toEqual([]);
  });

  it('alerts on stuck requests and queue backlog with actionable context', () => {
    const evaluator = new OllamaAnomalyEvaluator(anomalySettings);
    const observedAt = new Date('2026-09-10T12:10:00Z');
    const value = ollamaSnapshot({
      observedAt,
      queue: {
        observedAt,
        active: [
          {
            id: 'active',
            caller: 'publications-bot',
            model: 'qwen3',
            operation: 'chat',
            startedAt: new Date(observedAt.getTime() - 301_000),
            leaseExpiresAt: new Date(observedAt.getTime() + 10_000),
            timeoutMs: 300_000,
          },
        ],
        queued: [
          {
            id: 'queued',
            caller: 'news-bot',
            model: 'qwen3',
            operation: 'chat',
            queuedAt: new Date(observedAt.getTime() - 181_000),
            priority: 'normal',
          },
        ],
      },
    });
    const [event] = evaluator.evaluate(value);
    expect(event).toEqual({
      recovered: false,
      reasons: ['stuck-request', 'queue-backlog'],
    });
    expect(renderOllamaAnomaly(value, event!)).toContain(
      'publications-bot/chat/qwen3',
    );
    expect(renderOllamaAnomaly(value, event!)).toContain('oldest wait 3m 1s');
  });

  it('applies one cooldown across Ollama alerts and emits one recovery', () => {
    const evaluator = new OllamaAnomalyEvaluator({
      ...anomalySettings,
      cooldownMs: 60_000,
    });
    const at = new Date('2026-09-10T12:00:00Z');
    const multiple = (observedAt: Date): OllamaUsageSnapshot =>
      ollamaSnapshot({
        observedAt,
        queue: {
          observedAt,
          active: [0, 1].map((index) => ({
            id: String(index),
            caller: 'news-bot',
            model: 'qwen3',
            operation: 'chat' as const,
            startedAt: at,
            leaseExpiresAt: new Date(at.getTime() + 600_000),
            timeoutMs: 300_000,
          })),
          queued: [],
        },
      });
    expect(evaluator.evaluate(multiple(at))).toHaveLength(1);
    expect(
      evaluator.evaluate(multiple(new Date(at.getTime() + 30_000))),
    ).toEqual([]);
    expect(
      evaluator.evaluate(multiple(new Date(at.getTime() + 60_000))),
    ).toHaveLength(1);
    expect(
      evaluator.evaluate(
        ollamaSnapshot({ observedAt: new Date(at.getTime() + 61_000) }),
      ),
    ).toEqual([{ recovered: true, reasons: [] }]);
    expect(
      evaluator.evaluate(
        ollamaSnapshot({ observedAt: new Date(at.getTime() + 62_000) }),
      ),
    ).toEqual([]);
  });

  it('derives Ollama metrics from host processes and model placement', () => {
    const observedAt = new Date('2026-09-10T12:00:00Z');
    const result = ollamaUsageSnapshot(
      { observedAt, active: [], queued: [] },
      snapshot({
        observedAt,
        gpus: [{ name: 'GPU', utilizationPercent: 75 }],
        processes: [
          {
            pid: 1,
            name: '/usr/bin/ollama runner',
            cpuPercent: 240,
            memoryBytes: 1,
            memoryPercent: 1,
          },
        ],
      }),
      [{ model: 'qwen3', sizeBytes: 100, vramBytes: 70 }],
    );
    expect(result).toMatchObject({
      cpuPercent: 240,
      gpuUtilizationPercent: 75,
      cpuSharePercent: 30,
      gpuSharePercent: 70,
    });
  });
});
