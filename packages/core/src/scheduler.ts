import { Cron } from 'croner';

export const computeNextRun = (
  schedule: string,
  timezone: string,
  after = new Date(),
): Date => {
  const next = new Cron(schedule, { timezone }).nextRun(after);
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
    if (this.#activeTick) return this.#activeTick;

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
