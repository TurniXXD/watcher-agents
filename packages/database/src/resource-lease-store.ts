import type { DatabaseClient } from './client.js';

export class ResourceLeaseStore {
  public constructor(private readonly db: DatabaseClient) {}

  public withExclusiveLease<T>(
    resource: string,
    task: () => Promise<T>,
    timeoutMs = 1_200_000,
  ): Promise<T> {
    const normalized = resource.trim();
    if (!normalized || normalized.length > 100) {
      throw new Error('Resource lease name must contain 1–100 characters');
    }
    return this.db.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalized}))`;
        return task();
      },
      { maxWait: timeoutMs, timeout: timeoutMs },
    );
  }
}
