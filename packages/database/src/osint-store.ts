import { createHash } from 'node:crypto';
import type { DatabaseClient } from './client.js';

type EntityInput = { kind: string; key: string; label: string };
export type OsintDocumentInput = {
  sourceKey: string;
  sourceUrl: string;
  excerpt: string;
  data: Record<string, string | number | boolean | null>;
  observedAt?: Date | undefined;
  findings: {
    entity: EntityInput;
    predicate: string;
    value: string;
    observedAt?: Date | undefined;
  }[];
  links: {
    from: EntityInput;
    to: EntityInput;
    type: string;
    validFrom?: Date | undefined;
    validTo?: Date | undefined;
  }[];
};
export type OsintSelectorInput = {
  type: string;
  value: string;
  original: string;
  depth: number;
};
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export class OsintStore {
  constructor(private readonly db: DatabaseClient) {}

  async createInvestigation(
    userId: string,
    chatId: string,
    seed: string,
    selectors: OsintSelectorInput[],
  ) {
    return this.db.$transaction(async (tx) => {
      const investigation = await tx.osintInvestigation.create({
        data: {
          userId,
          chatId,
          seed: seed.slice(0, 500),
          selectors: { create: selectors },
        },
      });
      await tx.osintContext.upsert({
        where: { chatId_userId: { chatId, userId } },
        create: { chatId, userId, investigationId: investigation.id },
        update: { investigationId: investigation.id },
      });
      return investigation;
    });
  }

  async getContext(userId: string, chatId: string) {
    const context = await this.db.osintContext.findUnique({
      where: { chatId_userId: { chatId, userId } },
      include: { investigation: { include: { watch: true } } },
    });
    return context?.investigation ?? null;
  }

  async setContext(userId: string, chatId: string, investigationId: string) {
    const investigation = await this.getInvestigation(userId, investigationId);
    if (!investigation) return null;
    await this.db.osintContext.upsert({
      where: { chatId_userId: { chatId, userId } },
      create: { chatId, userId, investigationId },
      update: { investigationId },
    });
    return investigation;
  }

  getInvestigation(userId: string, id: string) {
    return this.db.osintInvestigation.findFirst({
      where: { id, userId },
      include: {
        selectors: true,
        _count: { select: { evidence: true, entities: true, runs: true } },
        watch: true,
      },
    });
  }

  listInvestigations(userId: string) {
    return this.db.osintInvestigation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { _count: { select: { evidence: true, entities: true } } },
    });
  }

  async addSelector(userId: string, id: string, selector: OsintSelectorInput) {
    if (!(await this.getInvestigation(userId, id))) return null;
    return this.db.osintSelector.upsert({
      where: {
        investigationId_type_value: {
          investigationId: id,
          type: selector.type,
          value: selector.value,
        },
      },
      create: { investigationId: id, ...selector },
      update: {},
    });
  }

  async beginRun(userId: string, id: string): Promise<boolean> {
    const updated = await this.db.osintInvestigation.updateMany({
      where: {
        id,
        userId,
        status: { notIn: ['RUNNING', 'STOPPED', 'PAUSED'] },
      },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        completedAt: null,
        lastError: null,
      },
    });
    return updated.count === 1;
  }

  async recoverStaleRuns(olderThan = new Date(Date.now() - 2 * 60_000)) {
    return this.db.osintInvestigation.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: olderThan } },
      data: {
        status: 'PARTIAL',
        completedAt: new Date(),
        lastError:
          'Previous process stopped before this run completed; retry is available.',
      },
    });
  }

  async finishRun(
    id: string,
    status: 'COMPLETE' | 'PARTIAL' | 'FAILED',
    error?: string,
  ) {
    await this.db.osintInvestigation.update({
      where: { id },
      data: { status, completedAt: new Date(), lastError: error ?? null },
    });
  }

  async setStatus(
    userId: string,
    id: string,
    status: 'PAUSED' | 'QUEUED' | 'STOPPED',
  ) {
    return this.db.osintInvestigation.updateMany({
      where: { id, userId, status: { not: 'RUNNING' } },
      data: { status },
    });
  }

  async recordCollectorRun(
    investigationId: string,
    selectorId: string,
    collectorId: string,
    status: 'SUCCESS' | 'FAILED',
    evidenceCount: number,
    error?: string,
  ) {
    await this.db.osintCollectorRun.create({
      data: {
        investigationId,
        selectorId,
        collectorId,
        status,
        evidenceCount,
        error: error?.slice(0, 400) ?? null,
        completedAt: new Date(),
      },
    });
  }

  async ingest(
    investigationId: string,
    collectorId: string,
    document: OsintDocumentInput,
  ): Promise<{ id: string; isNew: boolean }> {
    const contentHash = hash(
      JSON.stringify({
        data: document.data,
        findings: document.findings.map((finding) => [
          finding.entity.key,
          finding.predicate,
          finding.value,
        ]),
        links: document.links.map((link) => [
          link.from.key,
          link.to.key,
          link.type,
        ]),
      }),
    );
    return this.db.$transaction(async (tx) => {
      const where = {
        investigationId_sourceKey_contentHash: {
          investigationId,
          sourceKey: document.sourceKey,
          contentHash,
        },
      };
      const existing = await tx.osintEvidence.findUnique({ where });
      if (existing) return { id: existing.id, isNew: false };
      const evidence = await tx.osintEvidence.create({
        data: {
          investigationId,
          collectorId,
          sourceKey: document.sourceKey,
          sourceUrl: document.sourceUrl,
          contentHash,
          excerpt: document.excerpt.slice(0, 1500),
          data: document.data,
          observedAt: document.observedAt ?? null,
        },
      });
      const entityId = async (entity: EntityInput): Promise<string> => {
        const saved = await tx.osintEntity.upsert({
          where: {
            investigationId_kind_key: {
              investigationId,
              kind: entity.kind,
              key: entity.key,
            },
          },
          create: { investigationId, ...entity },
          update: { label: entity.label },
        });
        return saved.id;
      };
      for (const finding of document.findings) {
        const id = await entityId(finding.entity);
        await tx.osintObservation.create({
          data: {
            entityId: id,
            evidenceId: evidence.id,
            predicate: finding.predicate,
            value: finding.value.slice(0, 2000),
            valueHash: hash(finding.value),
            observedAt: finding.observedAt ?? document.observedAt ?? null,
          },
        });
      }
      for (const link of document.links) {
        const fromEntityId = await entityId(link.from);
        const toEntityId = await entityId(link.to);
        await tx.osintRelationship.create({
          data: {
            fromEntityId,
            toEntityId,
            evidenceId: evidence.id,
            type: link.type,
            validFrom: link.validFrom ?? null,
            validTo: link.validTo ?? null,
          },
        });
      }
      return { id: evidence.id, isNew: true };
    });
  }

  listEvidence(userId: string, investigationId: string) {
    return this.db.osintEvidence.findMany({
      where: { investigationId, investigation: { userId } },
      orderBy: { collectedAt: 'desc' },
      take: 25,
    });
  }
  latestStatutoryRoster(userId: string, investigationId: string) {
    return this.db.osintEvidence.findFirst({
      where: {
        investigationId,
        investigation: { userId },
        sourceKey: { startsWith: 'ares:register:roster:' },
      },
      orderBy: { collectedAt: 'desc' },
    });
  }
  getEvidence(userId: string, id: string) {
    return this.db.osintEvidence.findFirst({
      where: { id, investigation: { userId } },
      include: {
        observations: { include: { entity: true } },
        relationships: { include: { fromEntity: true, toEntity: true } },
      },
    });
  }
  listEntities(userId: string, investigationId: string) {
    return this.db.osintEntity.findMany({
      where: { investigationId, investigation: { userId } },
      orderBy: { kind: 'asc' },
      take: 100,
    });
  }
  getEntity(userId: string, id: string) {
    return this.db.osintEntity.findFirst({
      where: { id, investigation: { userId } },
      include: {
        observations: { include: { evidence: true }, take: 30 },
        outgoing: { include: { toEntity: true, evidence: true }, take: 30 },
        incoming: { include: { fromEntity: true, evidence: true }, take: 30 },
      },
    });
  }
  listTimeline(userId: string, investigationId: string) {
    return this.db.osintObservation.findMany({
      where: {
        entity: { investigationId, investigation: { userId } },
        observedAt: { not: null },
      },
      include: { entity: true, evidence: true },
      orderBy: { observedAt: 'asc' },
      take: 50,
    });
  }
  listRelationships(userId: string, investigationId: string) {
    return this.db.osintRelationship.findMany({
      where: { fromEntity: { investigationId, investigation: { userId } } },
      include: { fromEntity: true, toEntity: true, evidence: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
  }
  listFailures(userId: string, investigationId: string) {
    return this.db.osintCollectorRun.findMany({
      where: { investigationId, investigation: { userId }, status: 'FAILED' },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
  }
  async setWatch(
    userId: string,
    investigationId: string,
    enabled: boolean,
    intervalMinutes = 1440,
  ) {
    if (!(await this.getInvestigation(userId, investigationId))) return null;
    return this.db.osintWatch.upsert({
      where: { investigationId },
      create: {
        investigationId,
        enabled,
        intervalMinutes,
        nextRunAt: new Date(Date.now() + intervalMinutes * 60_000),
      },
      update: {
        enabled,
        intervalMinutes,
        nextRunAt: new Date(Date.now() + intervalMinutes * 60_000),
      },
    });
  }
  async claimDueWatches(now = new Date()) {
    const due = await this.db.osintWatch.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
        investigation: { status: { notIn: ['RUNNING', 'STOPPED', 'PAUSED'] } },
      },
      include: { investigation: true },
      take: 10,
    });
    for (const watch of due)
      await this.db.osintWatch.update({
        where: { investigationId: watch.investigationId },
        data: {
          nextRunAt: new Date(now.getTime() + watch.intervalMinutes * 60_000),
        },
      });
    return due;
  }
}
