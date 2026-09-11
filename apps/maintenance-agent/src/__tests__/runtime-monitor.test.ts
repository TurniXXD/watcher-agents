import { describe, expect, it } from 'vitest';
import {
  CapacityEvaluator,
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
    expect(renderSystemSnapshot(snapshot())).toContain(
      'GPU unavailable (GPU is not exposed to this container)',
    );
  });
});
