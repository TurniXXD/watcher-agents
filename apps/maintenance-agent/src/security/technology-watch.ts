import type { TechnologyAdvisory } from './osv.js';
import type { TechnologyWatchEntry } from './watchlist.js';

type AdvisorySource = {
  advisoriesFor(entry: TechnologyWatchEntry): Promise<TechnologyAdvisory[]>;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class TechnologyWatchService {
  public constructor(private readonly source: AdvisorySource) {}

  public async collect(watchlist: readonly TechnologyWatchEntry[]): Promise<{
    advisories: TechnologyAdvisory[];
    failures: Array<{ technologyId: string; error: string }>;
    evaluatedTechnologyIds: string[];
  }> {
    const enabled = watchlist.filter((entry) => entry.enabled);
    const settled = await Promise.allSettled(
      enabled.map((entry) => this.source.advisoriesFor(entry)),
    );
    const advisories: TechnologyAdvisory[] = [];
    const failures: Array<{ technologyId: string; error: string }> = [];
    const evaluatedTechnologyIds: string[] = [];
    settled.forEach((result, index) => {
      const entry = enabled[index];
      if (!entry) return;
      if (result.status === 'fulfilled') {
        advisories.push(...result.value);
        evaluatedTechnologyIds.push(entry.id);
      } else
        failures.push({
          technologyId: entry.id,
          error: errorMessage(result.reason),
        });
    });
    return { advisories, failures, evaluatedTechnologyIds };
  }
}
