import type { WatcherLogger } from '@watcher/core';
import type { SecurityEnricher } from './enrichment.js';
import type { SecurityIntelligenceService } from './service.js';
import type { TechnologyWatchService } from './technology-watch.js';
import type { TechnologyWatchEntry } from './watchlist.js';

export class SecurityWatchRunner {
  public constructor(
    private readonly watchlist: readonly TechnologyWatchEntry[],
    private readonly collector: TechnologyWatchService,
    private readonly enricher: SecurityEnricher,
    private readonly intelligence: SecurityIntelligenceService,
    private readonly logger: WatcherLogger,
  ) {}

  public async run(now = new Date()) {
    const collected = await this.collector.collect(this.watchlist);
    const advisories = await this.enricher.enrich(collected.advisories);
    const result = await this.intelligence.ingestTechnologyAdvisories(
      advisories,
      collected.evaluatedTechnologyIds,
      now,
    );
    const reportItems = await this.intelligence.currentReportItems(now);
    if (collected.failures.length) {
      this.logger.warn(
        { failures: collected.failures },
        'Some technology advisory sources failed',
      );
    }
    return { ...result, reportItems, failures: collected.failures };
  }
}
