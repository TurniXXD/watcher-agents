import { errorMessage, type WatcherLogger } from '@watcher/core';
import type { OsintStore } from '@watcher/database';
import { z } from 'zod';
import { selectCollectors, type Collector } from './collectors/types.js';
import {
  parseSelectors,
  selectorTypeSchema,
  type Selector,
} from './selectors.js';

export type InvestigationResult = {
  id: string;
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'BUSY';
  newEvidence: number;
  failures: string[];
  unsupported: string[];
};

export class OsintService {
  private readonly active = new Set<AbortController>();

  constructor(
    private readonly store: OsintStore,
    private readonly collectors: readonly Collector[],
    private readonly logger: WatcherLogger,
    private readonly maxCollectors = 12,
  ) {}

  async create(userId: string, chatId: string, query: string) {
    const selectors = parseSelectors(query);
    return this.store.createInvestigation(userId, chatId, query, selectors);
  }

  async expand(userId: string, investigationId: string, input: string) {
    const selectors = parseSelectors(input);
    for (const selector of selectors)
      await this.store.addSelector(userId, investigationId, {
        ...selector,
        depth: 1,
      });
    return this.run(userId, investigationId);
  }

  async run(
    userId: string,
    investigationId: string,
  ): Promise<InvestigationResult> {
    const investigation = await this.store.getInvestigation(
      userId,
      investigationId,
    );
    if (!investigation) throw new Error('Investigation not found');
    if (!(await this.store.beginRun(userId, investigationId)))
      return {
        id: investigationId,
        status: 'BUSY',
        newEvidence: 0,
        failures: [],
        unsupported: [],
      };
    const controller = new AbortController();
    this.active.add(controller);
    const deadline = setTimeout(() => controller.abort(), 75_000);
    const selectors: Selector[] = investigation.selectors.flatMap(
      (selector) => {
        const parsed = selectorTypeSchema.safeParse(selector.type);
        return parsed.success
          ? [
              {
                type: parsed.data,
                value: selector.value,
                original: selector.original,
                depth: selector.depth,
              },
            ]
          : [];
      },
    );
    const unsupported = new Set(
      selectors
        .filter(
          (selector) =>
            !this.collectors.some((collector) =>
              collector.supports.includes(selector.type),
            ),
        )
        .map((selector) => `${selector.type}: ${selector.value}`),
    );
    const selectorRows = new Map(
      investigation.selectors.map((selector) => [
        `${selector.type}:${selector.value}`,
        selector.id,
      ]),
    );
    const knownSelectors = new Set(selectorRows.keys());
    let wave = selectors;
    let remainingCollectors = this.maxCollectors;
    let newEvidence = 0;
    const failures: string[] = [];
    try {
      while (wave.length > 0 && remainingCollectors > 0) {
        const selected = selectCollectors(
          wave,
          this.collectors,
          remainingCollectors,
        );
        if (selected.length === 0) break;
        remainingCollectors -= selected.length;
        const outcomes = await Promise.allSettled(
          selected.map(async ({ selector, collector }) => {
            const selectorId = selectorRows.get(
              `${selector.type}:${selector.value}`,
            );
            if (!selectorId)
              throw new Error('Selector disappeared before collector run');
            try {
              const documents = await collector.collect(
                selector,
                controller.signal,
              );
              let added = 0;
              const discovered = [] as Selector[];
              for (const document of documents.slice(0, 30)) {
                const result = await this.store.ingest(
                  investigationId,
                  collector.id,
                  document,
                );
                if (result.isNew) added += 1;
                discovered.push(...(document.discoveredSelectors ?? []));
              }
              await this.store.recordCollectorRun(
                investigationId,
                selectorId,
                collector.id,
                'SUCCESS',
                documents.length,
              );
              return { added, discovered };
            } catch (error) {
              const message = errorMessage(error);
              await this.store.recordCollectorRun(
                investigationId,
                selectorId,
                collector.id,
                'FAILED',
                0,
                message,
              );
              throw new Error(collector.id, { cause: error });
            }
          }),
        );
        const nextWave: Selector[] = [];
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') {
            failures.push(errorMessage(outcome.reason).slice(0, 200));
            continue;
          }
          newEvidence += outcome.value.added;
          for (const discovered of outcome.value.discovered) {
            if (discovered.depth > (investigation.depthLimit ?? 1)) continue;
            const key = `${discovered.type}:${discovered.value}`;
            if (knownSelectors.has(key)) continue;
            const row = await this.store.addSelector(
              userId,
              investigationId,
              discovered,
            );
            if (!row) continue;
            knownSelectors.add(key);
            selectorRows.set(key, row.id);
            nextWave.push(discovered);
            if (
              !this.collectors.some((collector) =>
                collector.supports.includes(discovered.type),
              )
            )
              unsupported.add(`${discovered.type}: ${discovered.value}`);
          }
        }
        wave = nextWave;
      }
      const status =
        failures.length === 0 && unsupported.size === 0
          ? 'COMPLETE'
          : newEvidence > 0
            ? 'PARTIAL'
            : 'FAILED';
      await this.store.finishRun(
        investigationId,
        status,
        [...failures, ...unsupported].join(' | ').slice(0, 500),
      );
      this.logger.info(
        { investigationId, status, newEvidence, failureCount: failures.length },
        'OSINT investigation run completed',
      );
      return {
        id: investigationId,
        status,
        newEvidence,
        failures,
        unsupported: [...unsupported],
      };
    } catch (error) {
      await this.store.finishRun(
        investigationId,
        'FAILED',
        errorMessage(error).slice(0, 500),
      );
      throw error;
    } finally {
      clearTimeout(deadline);
      this.active.delete(controller);
    }
  }

  stop(): void {
    for (const controller of this.active) controller.abort();
  }
}

export const osintSummarySchema = z.object({
  inferences: z
    .array(
      z.object({
        statement: z.string().max(400),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(5),
  hypotheses: z
    .array(
      z.object({
        statement: z.string().max(400),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(3),
});
