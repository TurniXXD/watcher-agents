import type { TechnologyAdvisory } from './osv.js';
import type { TechnologyWatchEntry } from './watchlist.js';

type SourceClient = {
  advisoriesFor(entry: TechnologyWatchEntry): Promise<TechnologyAdvisory[]>;
};

export class TechnologyAdvisorySource implements SourceClient {
  public constructor(
    private readonly osv: SourceClient,
    private readonly nvd: SourceClient,
  ) {}

  public advisoriesFor(
    entry: TechnologyWatchEntry,
  ): Promise<TechnologyAdvisory[]> {
    if (entry.deploymentResponsibility === 'PROVIDER_MANAGED') {
      return Promise.resolve([]);
    }
    if (entry.matchingStrategy === 'OSV_PACKAGE') {
      return this.osv.advisoriesFor(entry);
    }
    if (entry.matchingStrategy === 'NVD_CPE') {
      return this.nvd.advisoriesFor(entry);
    }
    return Promise.resolve([]);
  }
}
