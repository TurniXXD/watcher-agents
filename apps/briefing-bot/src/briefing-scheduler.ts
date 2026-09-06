import type {
  BriefingScheduleStore,
  DueBriefingSchedule,
} from '@watcher/database';

type ScheduleStore = Pick<BriefingScheduleStore, 'claimDue'>;

export class BriefingScheduler {
  #timer: NodeJS.Timeout | undefined;
  #activeTick: Promise<void> | undefined;

  public constructor(
    private readonly schedules: ScheduleStore,
    private readonly execute: (schedule: DueBriefingSchedule) => Promise<void>,
    private readonly intervalMs = 30_000,
    private readonly reportError: (error: unknown) => void = () => undefined,
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
    const active = (async () => {
      const due = await this.schedules.claimDue(now);
      const results = await Promise.allSettled(due.map(this.execute));
      results.forEach((result) => {
        if (result.status === 'rejected') this.reportError(result.reason);
      });
    })()
      .catch(this.reportError)
      .finally(() => {
        if (this.#activeTick === active) this.#activeTick = undefined;
      });
    this.#activeTick = active;
    return active;
  }
}
