import { briefingEventStatusSchema } from '@watcher/core';
import { z } from 'zod';
import type { BriefingStoryState as DatabaseStoryState } from './generated/prisma/client.js';
import { BriefingEventStatus } from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';
import { BriefingConfigurationStore } from './briefing-configuration-store.js';

export const briefingStoryStateInputSchema = z
  .object({
    storyId: z.string().trim().min(1).max(200),
    mentionedAt: z.date(),
    summary: z.string().trim().min(1).max(10_000),
    importance: z.number().int().min(0).max(100),
    status: briefingEventStatusSchema,
    lastBriefingRunId: z.string().trim().min(1).optional(),
  })
  .strict();

export type BriefingStoryStateRecord = {
  storyId: string;
  firstMentionedAt: string;
  lastMentionedAt: string;
  lastSummary: string;
  importance: number;
  status: 'NEW' | 'DEVELOPING' | 'UNCHANGED' | 'RESOLVED';
  lastBriefingRunId?: string;
};

const toStoryState = (state: DatabaseStoryState): BriefingStoryStateRecord => ({
  storyId: state.storyId,
  firstMentionedAt: state.firstMentionedAt.toISOString(),
  lastMentionedAt: state.lastMentionedAt.toISOString(),
  lastSummary: state.lastSummary,
  importance: state.importance,
  status: state.status,
  ...(state.lastBriefingRunId
    ? { lastBriefingRunId: state.lastBriefingRunId }
    : {}),
});

export class BriefingStoryStore {
  private readonly configuration: BriefingConfigurationStore;

  public constructor(private readonly db: DatabaseClient) {
    this.configuration = new BriefingConfigurationStore(db);
  }

  public async save(telegramChatId: bigint, rawInput: unknown) {
    const input = briefingStoryStateInputSchema.parse(rawInput);
    const configuration = await this.configuration.ensure(telegramChatId);
    if (input.lastBriefingRunId) {
      const run = await this.db.briefingRun.findUnique({
        where: { id: input.lastBriefingRunId },
        select: { settingsId: true },
      });
      if (!run || run.settingsId !== configuration.settings.id) {
        throw new Error('Story state run must belong to the same briefing');
      }
    }
    const existing = await this.db.briefingStoryState.findUnique({
      where: {
        settingsId_storyId: {
          settingsId: configuration.settings.id,
          storyId: input.storyId,
        },
      },
    });
    if (existing && input.mentionedAt < existing.lastMentionedAt) {
      return toStoryState(existing);
    }
    const state = await this.db.briefingStoryState.upsert({
      where: {
        settingsId_storyId: {
          settingsId: configuration.settings.id,
          storyId: input.storyId,
        },
      },
      create: {
        settingsId: configuration.settings.id,
        storyId: input.storyId,
        firstMentionedAt: input.mentionedAt,
        lastMentionedAt: input.mentionedAt,
        lastSummary: input.summary,
        importance: input.importance,
        status: BriefingEventStatus[input.status],
        lastBriefingRunId: input.lastBriefingRunId ?? null,
      },
      update: {
        lastMentionedAt: input.mentionedAt,
        lastSummary: input.summary,
        importance: input.importance,
        status: BriefingEventStatus[input.status],
        lastBriefingRunId: input.lastBriefingRunId ?? null,
      },
    });
    return toStoryState(state);
  }

  public async list(telegramChatId: bigint) {
    const states = await this.db.briefingStoryState.findMany({
      where: { settings: { telegramChatId } },
      orderBy: [{ lastMentionedAt: 'desc' }, { storyId: 'asc' }],
    });
    return states.map(toStoryState);
  }
}
