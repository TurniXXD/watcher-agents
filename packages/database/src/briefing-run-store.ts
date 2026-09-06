import { watcherBotIdSchema, type WatcherBotId } from '@watcher/core';
import { z } from 'zod';
import type { BriefingRun as DatabaseBriefingRun } from './generated/prisma/client.js';
import {
  BriefingRunStatus,
  BriefingRunType,
} from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';
import {
  fromDatabaseVoice,
  fromDatabaseWatcher,
  toDatabaseVoice,
  toDatabaseWatcher,
  type BriefingVoiceId,
} from './utils/briefing-mappers.js';
import { BriefingConfigurationStore } from './briefing-configuration-store.js';
import { jsonObject, prismaJson } from './utils/json.js';

const runLocationSchema = z
  .object({
    city: z.string().trim().min(1).max(200).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict();

export const startBriefingRunSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(500),
    type: z.enum(['SCHEDULED', 'MANUAL', 'TEST']),
    scheduledFor: z.date().optional(),
    periodStart: z.date(),
    periodEnd: z.date(),
    subscriptions: z.array(watcherBotIdSchema),
    location: runLocationSchema.optional(),
    targetDurationSeconds: z.number().int().positive().max(3_600),
    maximumDurationSeconds: z.number().int().positive().max(3_600),
    voice: z.enum(['amy', 'hfc_female', 'hfc_male']).optional(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.periodStart > run.periodEnd) {
      context.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: 'Period end must not be before period start',
      });
    }
    if (run.maximumDurationSeconds < run.targetDurationSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['maximumDurationSeconds'],
        message: 'Maximum duration must be at least the target duration',
      });
    }
  });

export const completeBriefingRunSchema = z
  .object({
    status: z.enum(['SUCCESS', 'PARTIAL', 'FAILED']),
    weatherAvailable: z.boolean().optional(),
    calendarAvailable: z.boolean().optional(),
    selectedStoryIds: z.array(z.string().trim().min(1).max(200)).optional(),
    displayScript: z.string().optional(),
    ttsScript: z.string().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    actualAudioDurationSeconds: z.number().nonnegative().optional(),
    telegramMessageId: z.string().trim().min(1).max(200).optional(),
    failureReason: z.string().trim().min(1).max(5_000).optional(),
    briefingDataCoverage: z.number().int().min(0).max(100).optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type BriefingRunLocation = {
  city?: string;
  latitude?: number;
  longitude?: number;
};

export type BriefingRunRecord = {
  id: string;
  telegramChatId: string;
  idempotencyKey: string;
  type: 'SCHEDULED' | 'MANUAL' | 'TEST';
  scheduledFor?: string;
  startedAt: string;
  completedAt?: string;
  periodStart: string;
  periodEnd: string;
  subscriptions: WatcherBotId[];
  location?: BriefingRunLocation;
  weatherAvailable: boolean;
  calendarAvailable: boolean;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  selectedStoryIds: string[];
  displayScript?: string;
  ttsScript?: string;
  wordCount?: number;
  targetDurationSeconds: number;
  maximumDurationSeconds: number;
  actualAudioDurationSeconds?: number;
  voice?: BriefingVoiceId;
  telegramMessageId?: string;
  failureReason?: string;
  briefingDataCoverage?: number;
  metrics?: Record<string, unknown>;
};

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

const toRunLocation = (value: unknown): BriefingRunLocation => {
  const location = runLocationSchema.parse(value);
  return {
    ...(location.city ? { city: location.city } : {}),
    ...(location.latitude === undefined ? {} : { latitude: location.latitude }),
    ...(location.longitude === undefined
      ? {}
      : { longitude: location.longitude }),
  };
};

const toRun = (
  run: DatabaseBriefingRun,
  telegramChatId: bigint,
): BriefingRunRecord => ({
  id: run.id,
  telegramChatId: telegramChatId.toString(),
  idempotencyKey: run.idempotencyKey,
  type: run.type,
  ...(run.scheduledFor ? { scheduledFor: run.scheduledFor.toISOString() } : {}),
  startedAt: run.startedAt.toISOString(),
  ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
  periodStart: run.periodStart.toISOString(),
  periodEnd: run.periodEnd.toISOString(),
  subscriptions: run.subscriptions.map(fromDatabaseWatcher),
  ...(run.location && typeof run.location === 'object'
    ? { location: toRunLocation(run.location) }
    : {}),
  weatherAvailable: run.weatherAvailable,
  calendarAvailable: run.calendarAvailable,
  status: run.status,
  selectedStoryIds: run.selectedStoryIds,
  ...(run.displayScript ? { displayScript: run.displayScript } : {}),
  ...(run.ttsScript ? { ttsScript: run.ttsScript } : {}),
  ...(run.wordCount === null ? {} : { wordCount: run.wordCount }),
  targetDurationSeconds: run.targetDurationSeconds,
  maximumDurationSeconds: run.maximumDurationSeconds,
  ...(run.actualAudioDurationSeconds === null
    ? {}
    : { actualAudioDurationSeconds: run.actualAudioDurationSeconds }),
  ...(run.voice ? { voice: fromDatabaseVoice(run.voice) } : {}),
  ...(run.telegramMessageId
    ? { telegramMessageId: run.telegramMessageId }
    : {}),
  ...(run.failureReason ? { failureReason: run.failureReason } : {}),
  ...(run.briefingDataCoverage === null
    ? {}
    : { briefingDataCoverage: run.briefingDataCoverage }),
  ...(run.metrics && typeof run.metrics === 'object'
    ? { metrics: jsonObject(run.metrics) }
    : {}),
});

export class BriefingRunStore {
  private readonly configuration: BriefingConfigurationStore;

  public constructor(private readonly db: DatabaseClient) {
    this.configuration = new BriefingConfigurationStore(db);
  }

  public async start(
    telegramChatId: bigint,
    rawInput: unknown,
  ): Promise<{ run: BriefingRunRecord; created: boolean }> {
    const input = startBriefingRunSchema.parse(rawInput);
    const configuration = await this.configuration.ensure(telegramChatId);
    try {
      const run = await this.db.briefingRun.create({
        data: {
          settingsId: configuration.settings.id,
          idempotencyKey: input.idempotencyKey,
          type: BriefingRunType[input.type],
          scheduledFor: input.scheduledFor ?? null,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          subscriptions: input.subscriptions.map(toDatabaseWatcher),
          ...(input.location ? { location: prismaJson(input.location) } : {}),
          targetDurationSeconds: input.targetDurationSeconds,
          maximumDurationSeconds: input.maximumDurationSeconds,
          ...(input.voice ? { voice: toDatabaseVoice(input.voice) } : {}),
        },
      });
      return { run: toRun(run, telegramChatId), created: true };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const existing = await this.db.briefingRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { settings: { select: { telegramChatId: true } } },
      });
      if (!existing || existing.settings.telegramChatId !== telegramChatId) {
        throw new Error('Briefing run idempotency key collision', {
          cause: error,
        });
      }
      return { run: toRun(existing, telegramChatId), created: false };
    }
  }

  public async complete(runId: string, rawResult: unknown) {
    const result = completeBriefingRunSchema.parse(rawResult);
    const run = await this.db.briefingRun.update({
      where: { id: runId },
      data: {
        status: BriefingRunStatus[result.status],
        completedAt: new Date(),
        ...(result.weatherAvailable === undefined
          ? {}
          : { weatherAvailable: result.weatherAvailable }),
        ...(result.calendarAvailable === undefined
          ? {}
          : { calendarAvailable: result.calendarAvailable }),
        ...(result.selectedStoryIds
          ? { selectedStoryIds: result.selectedStoryIds }
          : {}),
        ...(result.displayScript === undefined
          ? {}
          : { displayScript: result.displayScript }),
        ...(result.ttsScript === undefined
          ? {}
          : { ttsScript: result.ttsScript }),
        ...(result.wordCount === undefined
          ? {}
          : { wordCount: result.wordCount }),
        ...(result.actualAudioDurationSeconds === undefined
          ? {}
          : {
              actualAudioDurationSeconds: result.actualAudioDurationSeconds,
            }),
        ...(result.telegramMessageId === undefined
          ? {}
          : { telegramMessageId: result.telegramMessageId }),
        ...(result.failureReason === undefined
          ? {}
          : { failureReason: result.failureReason }),
        ...(result.briefingDataCoverage === undefined
          ? {}
          : { briefingDataCoverage: result.briefingDataCoverage }),
        ...(result.metrics === undefined
          ? {}
          : { metrics: prismaJson(result.metrics) }),
      },
      include: { settings: { select: { telegramChatId: true } } },
    });
    return toRun(run, run.settings.telegramChatId);
  }

  public async lastSuccessfulScheduled(
    telegramChatId: bigint,
  ): Promise<BriefingRunRecord | undefined> {
    const run = await this.db.briefingRun.findFirst({
      where: {
        settings: { telegramChatId },
        type: BriefingRunType.SCHEDULED,
        status: BriefingRunStatus.SUCCESS,
      },
      orderBy: { periodEnd: 'desc' },
    });
    return run ? toRun(run, telegramChatId) : undefined;
  }
}
