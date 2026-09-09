import { randomUUID } from 'node:crypto';
import {
  AgentTelemetryStore,
  LegacyTelemetryImporter,
  MaintenanceStore,
  type DatabaseClient,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import { detectAll } from './detectors.js';
import { calculateSourceHealth } from './source-health.js';
import type { Finding, RunObservation } from './types.js';

export type EvaluationType = 'HEALTH' | 'DAILY' | 'WEEKLY' | 'MANUAL';

const errorObject = (value: unknown): unknown => value ?? undefined;

export class MaintenanceEngine {
  readonly #store: MaintenanceStore;
  readonly #importer: LegacyTelemetryImporter;
  readonly #telemetry: AgentTelemetryStore;
  #active: Promise<{ findings: Finding[]; runId: string }> | undefined;

  public constructor(
    database: DatabaseClient,
    private readonly logger: WatcherLogger,
    private readonly selfReviewEnabled = false,
  ) {
    this.#store = new MaintenanceStore(database);
    this.#importer = new LegacyTelemetryImporter(database);
    this.#telemetry = new AgentTelemetryStore(database);
  }

  public store(): MaintenanceStore {
    return this.#store;
  }

  public run(type: EvaluationType, lookbackHours: number, now = new Date()) {
    if (this.#active) return this.#active;
    this.#active = this.execute(type, lookbackHours, now).finally(() => {
      this.#active = undefined;
    });
    return this.#active;
  }

  private async execute(type: EvaluationType, lookbackHours: number, now: Date) {
    const maintenanceRun = await this.#store.startRun(type, lookbackHours);
    const startedAt = new Date();
    try {
      const since = new Date(now.getTime() - lookbackHours * 3_600_000);
      const importedRuns = await this.#importer.importSince(since);
      const rows = await this.#store.listRuns(since);
      const runs: RunObservation[] = rows
        .filter((row) => this.selfReviewEnabled || row.agentName !== 'maintenance-agent')
        .map((row) => ({
          id: row.id,
          agentName: row.agentName,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          status: row.status,
          latencyMs: row.latencyMs,
          llmInputTokens: row.llmInputTokens,
          llmOutputTokens: row.llmOutputTokens,
          llmCostUsd: row.llmCostUsd === null ? null : Number(row.llmCostUsd),
          itemsFetched: row.itemsFetched,
          itemsProduced: row.itemsProduced,
          itemsFiltered: row.itemsFiltered,
          duplicatesRemoved: row.duplicatesRemoved,
          error: errorObject(row.error),
          metadata: row.metadata,
          sources: row.sources.map((source) => ({
            sourceId: source.sourceId,
            status: source.status,
            latencyMs: source.latencyMs,
            itemCount: source.itemCount,
            error: source.error,
            createdAt: source.createdAt,
          })),
          feedback: row.feedback.map((feedback) => ({
            action: feedback.action,
            reason: feedback.reason,
          })),
        }));
      const sourceHealth = calculateSourceHealth(runs, now);
      await Promise.all(
        sourceHealth.map((health) =>
          this.#store.upsertSourceHealth({
            ...health,
            uniqueItemsProduced: Math.max(
              0,
              health.itemsProduced - Math.round((health.duplicateRate ?? 0) * health.itemsProduced),
            ),
          }),
        ),
      );
      const findings = detectAll(runs, now);
      let recommendationCount = 0;
      for (const finding of findings) {
        const saved = await this.#store.upsertFinding(finding);
        await this.#store.upsertRecommendation({
          fingerprint: `${finding.fingerprint}:${finding.recommendation.type}`,
          findingId: saved.id,
          agentName: finding.agentName,
          type: finding.recommendation.type,
          title: finding.recommendation.title,
          rationale: finding.recommendation.rationale,
          confidence: finding.confidence,
          ...(finding.recommendation.expectedImpact
            ? { expectedImpact: finding.recommendation.expectedImpact }
            : {}),
          ...(finding.recommendation.risk ? { risk: finding.recommendation.risk } : {}),
          ...(finding.recommendation.proposal
            ? { proposal: finding.recommendation.proposal }
            : {}),
        });
        recommendationCount++;
      }
      const finishedAt = new Date();
      const metrics = {
        importedRuns,
        analyzedRuns: runs.length,
        sourceCount: sourceHealth.length,
        latencyMs: finishedAt.getTime() - startedAt.getTime(),
      };
      await this.#store.finishRun(maintenanceRun.id, {
        status: 'SUCCESS',
        findingCount: findings.length,
        recommendationCount,
        metrics,
      });
      await this.#telemetry.recordRun({
        id: `maintenance:${maintenanceRun.id}`,
        agentName: 'maintenance-agent',
        startedAt,
        finishedAt,
        status: 'success',
        metrics: {
          latencyMs: metrics.latencyMs,
          itemsFetched: runs.length,
          itemsProduced: findings.length,
        },
        metadata: { type, lookbackHours, recommendationCount, correlationId: randomUUID() },
      });
      this.logger.info(
        { maintenanceRunId: maintenanceRun.id, type, ...metrics, findingCount: findings.length },
        'Maintenance evaluation completed',
      );
      return { findings, runId: maintenanceRun.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#store.finishRun(maintenanceRun.id, { status: 'FAILED', error: message });
      await this.#telemetry.recordRun({
        id: `maintenance:${maintenanceRun.id}`,
        agentName: 'maintenance-agent',
        startedAt,
        finishedAt: new Date(),
        status: 'failed',
        error: { message },
        metrics: { latencyMs: Date.now() - startedAt.getTime() },
        metadata: { type, lookbackHours },
      });
      this.logger.error({ err: error, type, maintenanceRunId: maintenanceRun.id }, 'Maintenance evaluation failed');
      throw error;
    }
  }
}
