ALTER TABLE "briefing_runs"
ADD CONSTRAINT "briefing_runs_data_coverage_check"
CHECK ("briefingDataCoverage" IS NULL OR "briefingDataCoverage" BETWEEN 0 AND 100);

ALTER TABLE "briefing_watcher_health"
ADD CONSTRAINT "briefing_watcher_health_counts_check"
CHECK (
  "eventsEmitted" >= 0
  AND "failedEventPublications" >= 0
  AND "sourceFailures" >= 0
);
