import type { DatabaseClient } from './client.js';
import {
  MaintenanceFindingStatus,
  MaintenanceFindingType,
  MaintenanceRecommendationStatus,
  MaintenanceRecommendationType,
  MaintenanceRunStatus,
  MaintenanceRunType,
  MaintenanceSeverity,
} from './generated/prisma/enums.js';
import { prismaJson } from './utils/json.js';

export type FindingInput = {
  fingerprint: string;
  agentName: string;
  type: keyof typeof MaintenanceFindingType;
  severity: keyof typeof MaintenanceSeverity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  confidence: number;
  detectedAt: Date;
};

export type RecommendationInput = {
  fingerprint: string;
  findingId: string;
  agentName: string;
  type: keyof typeof MaintenanceRecommendationType;
  title: string;
  rationale: string;
  confidence: number;
  expectedImpact?: string;
  risk?: string;
  proposal?: Record<string, unknown>;
};

export class MaintenanceStore {
  public constructor(private readonly db: DatabaseClient) {}

  public listRuns(since: Date, agentName?: string) {
    return this.db.agentRun.findMany({
      where: { startedAt: { gte: since }, ...(agentName ? { agentName } : {}) },
      include: { sources: true, feedback: true },
      orderBy: { startedAt: 'asc' },
    });
  }

  public async agentNames(): Promise<string[]> {
    const rows = await this.db.agentRun.findMany({
      distinct: ['agentName'],
      select: { agentName: true },
    });
    return rows.map((row) => row.agentName).sort();
  }

  public upsertSourceHealth(input: {
    agentName: string;
    sourceId: string;
    windowStartedAt: Date;
    windowEndedAt: Date;
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
    lastSuccessfulAt?: Date;
    lastNewItemAt?: Date;
    averageLatencyMs?: number;
    consecutiveFailures: number;
    itemsProduced: number;
    uniqueItemsProduced: number;
    duplicateRate?: number;
    staleDays?: number;
  }) {
    const data = {
      windowStartedAt: input.windowStartedAt,
      windowEndedAt: input.windowEndedAt,
      totalRuns: input.totalRuns,
      successfulRuns: input.successfulRuns,
      failedRuns: input.failedRuns,
      successRate: input.successRate,
      lastSuccessfulAt: input.lastSuccessfulAt ?? null,
      lastNewItemAt: input.lastNewItemAt ?? null,
      averageLatencyMs: input.averageLatencyMs ?? null,
      consecutiveFailures: input.consecutiveFailures,
      itemsProduced: input.itemsProduced,
      uniqueItemsProduced: input.uniqueItemsProduced,
      duplicateRate: input.duplicateRate ?? null,
      staleDays: input.staleDays ?? null,
    };
    return this.db.maintenanceSourceHealth.upsert({
      where: {
        agentName_sourceId: {
          agentName: input.agentName,
          sourceId: input.sourceId,
        },
      },
      create: { agentName: input.agentName, sourceId: input.sourceId, ...data },
      update: data,
    });
  }

  public upsertFinding(input: FindingInput) {
    return this.db.maintenanceFinding.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        ...input,
        type: MaintenanceFindingType[input.type],
        severity: MaintenanceSeverity[input.severity],
        evidence: prismaJson(input.evidence),
        lastSeenAt: input.detectedAt,
      },
      update: {
        severity: MaintenanceSeverity[input.severity],
        title: input.title,
        description: input.description,
        evidence: prismaJson(input.evidence),
        confidence: input.confidence,
        lastSeenAt: input.detectedAt,
        occurrenceCount: { increment: 1 },
        status: MaintenanceFindingStatus.OPEN,
      },
    });
  }

  public upsertRecommendation(input: RecommendationInput) {
    return this.db.maintenanceRecommendation.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        fingerprint: input.fingerprint,
        findingId: input.findingId,
        agentName: input.agentName,
        type: MaintenanceRecommendationType[input.type],
        title: input.title,
        rationale: input.rationale,
        confidence: input.confidence,
        expectedImpact: input.expectedImpact ?? null,
        risk: input.risk ?? null,
        ...(input.proposal ? { proposal: prismaJson(input.proposal) } : {}),
      },
      update: {
        title: input.title,
        rationale: input.rationale,
        confidence: input.confidence,
        expectedImpact: input.expectedImpact ?? null,
        risk: input.risk ?? null,
        ...(input.proposal ? { proposal: prismaJson(input.proposal) } : {}),
      },
    });
  }

  public listFindings(filters: {
    agent?: string;
    type?: keyof typeof MaintenanceFindingType;
    severity?: keyof typeof MaintenanceSeverity;
    status?: keyof typeof MaintenanceFindingStatus;
    since?: Date;
    limit: number;
  }) {
    return this.db.maintenanceFinding.findMany({
      where: {
        ...(filters.agent ? { agentName: filters.agent } : {}),
        ...(filters.type ? { type: MaintenanceFindingType[filters.type] } : {}),
        ...(filters.severity
          ? { severity: MaintenanceSeverity[filters.severity] }
          : {}),
        ...(filters.status
          ? { status: MaintenanceFindingStatus[filters.status] }
          : {}),
        ...(filters.since ? { lastSeenAt: { gte: filters.since } } : {}),
      },
      include: { recommendations: true },
      orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
      take: filters.limit,
    });
  }

  public finding(id: string) {
    return this.db.maintenanceFinding.findUnique({
      where: { id },
      include: { recommendations: true },
    });
  }

  public listRecommendations(filters: {
    agent?: string;
    type?: keyof typeof MaintenanceRecommendationType;
    status?: keyof typeof MaintenanceRecommendationStatus;
    minConfidence?: number;
    limit: number;
  }) {
    return this.db.maintenanceRecommendation.findMany({
      where: {
        ...(filters.agent ? { agentName: filters.agent } : {}),
        ...(filters.type
          ? { type: MaintenanceRecommendationType[filters.type] }
          : {}),
        ...(filters.status
          ? { status: MaintenanceRecommendationStatus[filters.status] }
          : {}),
        ...(filters.minConfidence === undefined
          ? {}
          : { confidence: { gte: filters.minConfidence } }),
      },
      include: { finding: true },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });
  }

  public recommendation(id: string) {
    return this.db.maintenanceRecommendation.findUnique({
      where: { id },
      include: { finding: true },
    });
  }

  public setRecommendationStatus(id: string, status: 'APPROVED' | 'REJECTED') {
    return this.db.maintenanceRecommendation.update({
      where: { id },
      data: { status: MaintenanceRecommendationStatus[status] },
    });
  }

  public startRun(
    type: keyof typeof MaintenanceRunType,
    lookbackHours: number,
  ) {
    return this.db.maintenanceRun.create({
      data: { type: MaintenanceRunType[type], lookbackHours },
    });
  }

  public finishRun(
    id: string,
    input:
      | {
          status: 'SUCCESS';
          findingCount: number;
          recommendationCount: number;
          metrics: Record<string, unknown>;
        }
      | { status: 'FAILED'; error: string },
  ) {
    return this.db.maintenanceRun.update({
      where: { id },
      data:
        input.status === 'SUCCESS'
          ? {
              status: MaintenanceRunStatus.SUCCESS,
              finishedAt: new Date(),
              findingCount: input.findingCount,
              recommendationCount: input.recommendationCount,
              metrics: prismaJson(input.metrics),
            }
          : {
              status: MaintenanceRunStatus.FAILED,
              finishedAt: new Date(),
              error: input.error,
            },
    });
  }

  public latestRun(type: keyof typeof MaintenanceRunType) {
    return this.db.maintenanceRun.findFirst({
      where: {
        type: MaintenanceRunType[type],
        status: MaintenanceRunStatus.SUCCESS,
      },
      orderBy: { finishedAt: 'desc' },
    });
  }

  public sourceHealth() {
    return this.db.maintenanceSourceHealth.findMany({
      orderBy: [{ agentName: 'asc' }, { sourceId: 'asc' }],
    });
  }

  public async claimChangeAnnouncement(
    contentHash: string,
    chatId: bigint,
    title: string,
  ): Promise<boolean> {
    try {
      await this.db.maintenanceChangeAnnouncement.create({
        data: { contentHash, chatId, title },
      });
      return true;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }
}
