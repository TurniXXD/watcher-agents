import { Cron } from 'croner';
import type { WatcherLogger } from './logger.js';

export const parseScheduleExpressions = (schedule: string): string[] =>
  schedule
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

export const computeNextRun = (
  schedule: string,
  timezone: string,
  after = new Date(),
): Date => {
  const parts = parseScheduleExpressions(schedule);
  if (parts.length === 0) {
    throw new Error('Schedule must include at least one cron expression.');
  }

  const nextRuns = parts
    .map((part) => new Cron(part, { timezone }).nextRun(after))
    .filter((nextRun): nextRun is Date => nextRun instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime());
  const next = nextRuns[0];
  if (!next) throw new Error(`Schedule has no future occurrence: ${schedule}`);
  return next;
};

export class RunGuard {
  readonly #running = new Set<string>();

  public async run<T>(
    key: string,
    task: () => Promise<T>,
  ): Promise<T | undefined> {
    if (this.#running.has(key)) return undefined;
    this.#running.add(key);

    try {
      return await task();
    } finally {
      this.#running.delete(key);
    }
  }
}

export type DueSchedule = { id: string };

export class PersistentScheduler {
  #timer: NodeJS.Timeout | undefined;
  #activeTick: Promise<void> | undefined;

  public constructor(
    private readonly listDue: (now: Date) => Promise<DueSchedule[]>,
    private readonly execute: (schedule: DueSchedule) => Promise<void>,
    private readonly intervalMs = 30_000,
    private readonly logger?: WatcherLogger,
  ) {}

  public start(): void {
    if (this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.intervalMs);
    this.#timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#activeTick;
  }

  public tick(now = new Date()): Promise<void> {
    if (this.#activeTick) {
      this.logger?.info(
        { now: now.toISOString() },
        'Scheduler tick skipped because the previous tick is active',
      );
      return this.#activeTick;
    }

    const activeTick = (async () => {
      const due = await this.listDue(now);
      await Promise.allSettled(due.map((schedule) => this.execute(schedule)));
    })().finally(() => {
      if (this.#activeTick === activeTick) this.#activeTick = undefined;
    });
    this.#activeTick = activeTick;
    return activeTick;
  }
}
