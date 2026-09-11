import { describe, expect, it } from 'vitest';
import {
  CapacityEvaluator,
  renderTopProcesses,
  renderSystemSnapshot,
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
});
