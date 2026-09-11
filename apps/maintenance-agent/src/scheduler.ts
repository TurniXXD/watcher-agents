import type { WatcherLogger } from '@watcher/core';
import type { MaintenanceStore } from '@watcher/database';
import type { MaintenanceEngine, EvaluationType } from './evaluation/engine.js';
import type { Finding } from './evaluation/types.js';

type ScheduledType = Exclude<EvaluationType, 'MANUAL'>;

export class MaintenanceScheduler {
  #timer: NodeJS.Timeout | undefined;
  #initialTimer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  public constructor(
    private readonly engine: MaintenanceEngine,
    private readonly store: MaintenanceStore,
    private readonly settings: {
      enabled: boolean;
      tickMs: number;
      healthMinutes: number;
      dailyMinutes: number;
      weeklyEnabled: boolean;
      weeklyMinutes: number;
      jitterMaxSeconds: number;
    },
    private readonly onReport: (
      type: ScheduledType,
      findings: Finding[],
    ) => Promise<void>,
    private readonly logger: WatcherLogger,
  ) {}

  public start(): void {
    if (!this.settings.enabled || this.#timer) return;
    const initialJitter =
      Math.floor(Math.random() * (this.settings.jitterMaxSeconds + 1)) * 1000;
    this.#timer = setInterval(() => void this.tick(), this.settings.tickMs);
    this.#timer.unref();
    this.#initialTimer = setTimeout(() => {
      this.#initialTimer = undefined;
      void this.tick();
    }, initialJitter);
    this.#initialTimer.unref();
    this.logger.info(
      { ...this.settings, initialJitter },
      'Maintenance scheduler started',
    );
  }

  public async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#initialTimer) clearTimeout(this.#initialTimer);
    this.#timer = undefined;
    this.#initialTimer = undefined;
    await this.#running;
  }

  private async due(type: ScheduledType, intervalMinutes: number, now: Date) {
    const latest = await this.store.latestRun(type);
    return (
      !latest?.finishedAt ||
      now.getTime() - latest.finishedAt.getTime() >= intervalMinutes * 60_000
    );
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
      const now = new Date();
      const candidates: Array<[ScheduledType, number, number]> = [];
      if (this.settings.weeklyEnabled) {
        candidates.push(['WEEKLY', this.settings.weeklyMinutes, 24 * 30]);
      }
      candidates.push(
        ['DAILY', this.settings.dailyMinutes, 24 * 7],
        ['HEALTH', this.settings.healthMinutes, 24],
      );
      for (const [type, interval, lookbackHours] of candidates) {
        if (!(await this.due(type, interval, now))) continue;
        const result = await this.engine.run(type, lookbackHours, now);
        if (type !== 'HEALTH') await this.onReport(type, result.findings);
        return;
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Maintenance scheduler tick failed');
    }
  }
}
