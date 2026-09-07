import {
  registeredWatcherBots,
  watcherBotIdSchema,
  type WatcherBotId,
} from '@watcher/core';
import { z } from 'zod';
import type { Prisma } from './generated/prisma/client.js';
import {
  BriefingLocationMode,
  BriefingOnboardingStep,
} from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';
import { normalizeBriefingScheduleSpec } from './briefing-schedule-spec.js';
import {
  fromDatabaseVoice,
  fromDatabaseWatcher,
  toDatabaseVoice,
  toDatabaseWatcher,
} from './utils/briefing-mappers.js';

export const briefingVoiceIdSchema = z.enum(['amy', 'hfc_female', 'hfc_male']);
export type BriefingVoiceId = z.infer<typeof briefingVoiceIdSchema>;

export const briefingOnboardingStepSchema = z.enum([
  'LOCATION',
  'VOICE',
  'GOOGLE_CALENDAR',
  'SUBSCRIPTIONS',
  'BRIEFING_TIME',
  'COMPLETE',
]);
export type BriefingOnboardingStepId = z.infer<
  typeof briefingOnboardingStepSchema
>;

const validTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

export const briefingScheduleSpecSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .transform((value, context) => {
    try {
      return normalizeBriefingScheduleSpec(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message:
          error instanceof Error
            ? error.message
            : 'Expected HH:mm or weekly:DAY:HH:mm entries separated by semicolons',
      });
      return z.NEVER;
    }
  });

export const briefingPreferencesSchema = z
  .object({
    language: z.literal('en'),
    voice: briefingVoiceIdSchema,
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine(validTimezone, 'Invalid timezone'),
    briefingTime: briefingScheduleSpecSchema,
    targetDurationMinutes: z.number().int().min(1).max(30),
    maximumDurationMinutes: z.number().int().min(1).max(30),
    sendTranscript: z.boolean(),
    calendarEnabled: z.boolean(),
    weatherEnabled: z.boolean(),
    priorityKeywords: z.array(z.string().trim().min(2).max(100)).max(50),
    mutedKeywords: z.array(z.string().trim().min(2).max(100)).max(50),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.maximumDurationMinutes < settings.targetDurationMinutes) {
      context.addIssue({
        code: 'custom',
        path: ['maximumDurationMinutes'],
        message: 'Maximum duration must be at least the target duration',
      });
    }
  });

export const briefingPreferencesPatchSchema = z
  .object({
    language: z.literal('en').optional(),
    voice: briefingVoiceIdSchema.optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine(validTimezone, 'Invalid timezone')
      .optional(),
    briefingTime: briefingScheduleSpecSchema.optional(),
    targetDurationMinutes: z.number().int().min(1).max(30).optional(),
    maximumDurationMinutes: z.number().int().min(1).max(30).optional(),
    sendTranscript: z.boolean().optional(),
    calendarEnabled: z.boolean().optional(),
    weatherEnabled: z.boolean().optional(),
    priorityKeywords: z
      .array(z.string().trim().min(2).max(100))
      .max(50)
      .optional(),
    mutedKeywords: z
      .array(z.string().trim().min(2).max(100))
      .max(50)
      .optional(),
  })
  .strict();

export const briefingLocationInputSchema = z
  .object({
    mode: z.enum(['STATIC', 'LAST_SHARED', 'DISABLED']),
    city: z.string().trim().min(1).max(200).optional(),
    country: z.string().trim().min(1).max(100).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .superRefine((location, context) => {
    const hasCoordinates =
      location.latitude !== undefined && location.longitude !== undefined;
    if (location.mode === 'DISABLED' && hasCoordinates) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled location cannot contain coordinates',
      });
    }
    if (location.mode !== 'DISABLED' && !hasCoordinates) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled location requires latitude and longitude',
      });
    }
    if (
      (location.latitude === undefined) !==
      (location.longitude === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Latitude and longitude must be provided together',
      });
    }
  });

export type BriefingLocationInput = z.infer<typeof briefingLocationInputSchema>;

export type BriefingSettingsRecord = z.infer<
  typeof briefingPreferencesSchema
> & {
  id: string;
  telegramChatId: string;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BriefingSubscriptionRecord = {
  id: string;
  watcherBot: WatcherBotId;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BriefingLocationRecord = BriefingLocationInput & {
  id: string;
  updatedAt: string;
};

export type BriefingOnboardingRecord = {
  completed: boolean;
  currentStep: BriefingOnboardingStepId;
  updatedAt: string;
};

export type BriefingConfiguration = {
  settings: BriefingSettingsRecord;
  subscriptions: BriefingSubscriptionRecord[];
  location?: BriefingLocationRecord;
  onboarding: BriefingOnboardingRecord;
};

type ConfigurationRow = Prisma.BriefingSettingsGetPayload<{
  include: { subscriptions: true; location: true; onboarding: true };
}>;

const locationMode = (mode: BriefingLocationInput['mode']) =>
  BriefingLocationMode[mode];

const onboardingStep = (step: BriefingOnboardingStepId) =>
  BriefingOnboardingStep[step];

const toConfiguration = (row: ConfigurationRow): BriefingConfiguration => ({
  settings: {
    id: row.id,
    telegramChatId: row.telegramChatId.toString(),
    onboardingComplete: row.onboardingComplete,
    language: 'en',
    voice: fromDatabaseVoice(row.voice),
    timezone: row.timezone,
    briefingTime: row.briefingTime,
    targetDurationMinutes: row.targetDurationMinutes,
    maximumDurationMinutes: row.maximumDurationMinutes,
    sendTranscript: row.sendTranscript,
    calendarEnabled: row.calendarEnabled,
    weatherEnabled: row.weatherEnabled,
    priorityKeywords: row.priorityKeywords,
    mutedKeywords: row.mutedKeywords,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  },
  subscriptions: row.subscriptions
    .map((subscription) => ({
      id: subscription.id,
      watcherBot: fromDatabaseWatcher(subscription.watcherBot),
      enabled: subscription.enabled,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    }))
    .sort((left, right) => left.watcherBot.localeCompare(right.watcherBot)),
  ...(row.location
    ? {
        location: {
          id: row.location.id,
          mode: row.location.mode,
          ...(row.location.city ? { city: row.location.city } : {}),
          ...(row.location.country ? { country: row.location.country } : {}),
          ...(row.location.latitude === null
            ? {}
            : { latitude: row.location.latitude }),
          ...(row.location.longitude === null
            ? {}
            : { longitude: row.location.longitude }),
          updatedAt: row.location.updatedAt.toISOString(),
        },
      }
    : {}),
  onboarding: {
    completed: row.onboarding?.completed ?? false,
    currentStep: row.onboarding?.currentStep ?? 'LOCATION',
    updatedAt: (row.onboarding?.updatedAt ?? row.updatedAt).toISOString(),
  },
});

export class BriefingConfigurationStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async ensure(telegramChatId: bigint): Promise<BriefingConfiguration> {
    const settings = await this.db.briefingSettings.upsert({
      where: { telegramChatId },
      create: { telegramChatId },
      update: {},
    });
    await this.db.$transaction([
      this.db.briefingSubscription.createMany({
        data: registeredWatcherBots.map((watcherBot) => ({
          settingsId: settings.id,
          watcherBot: toDatabaseWatcher(watcherBot),
          enabled: true,
        })),
        skipDuplicates: true,
      }),
      this.db.onboardingState.upsert({
        where: { settingsId: settings.id },
        create: { settingsId: settings.id },
        update: {},
      }),
    ]);
    return this.getRequired(telegramChatId);
  }

  public async get(
    telegramChatId: bigint,
  ): Promise<BriefingConfiguration | undefined> {
    const row = await this.db.briefingSettings.findUnique({
      where: { telegramChatId },
      include: { subscriptions: true, location: true, onboarding: true },
    });
    return row ? toConfiguration(row) : undefined;
  }

  public async updateSettings(
    telegramChatId: bigint,
    rawPatch: unknown,
  ): Promise<BriefingConfiguration> {
    const patch = briefingPreferencesPatchSchema.parse(rawPatch);
    const current = await this.ensure(telegramChatId);
    const preferences = briefingPreferencesSchema.parse({
      language: current.settings.language,
      voice: current.settings.voice,
      timezone: current.settings.timezone,
      briefingTime: current.settings.briefingTime,
      targetDurationMinutes: current.settings.targetDurationMinutes,
      maximumDurationMinutes: current.settings.maximumDurationMinutes,
      sendTranscript: current.settings.sendTranscript,
      calendarEnabled: current.settings.calendarEnabled,
      weatherEnabled: current.settings.weatherEnabled,
      priorityKeywords: current.settings.priorityKeywords,
      mutedKeywords: current.settings.mutedKeywords,
      ...patch,
    });
    await this.db.briefingSettings.update({
      where: { id: current.settings.id },
      data: {
        language: preferences.language,
        voice: toDatabaseVoice(preferences.voice),
        timezone: preferences.timezone,
        briefingTime: preferences.briefingTime,
        targetDurationMinutes: preferences.targetDurationMinutes,
        maximumDurationMinutes: preferences.maximumDurationMinutes,
        sendTranscript: preferences.sendTranscript,
        calendarEnabled: preferences.calendarEnabled,
        weatherEnabled: preferences.weatherEnabled,
        priorityKeywords: preferences.priorityKeywords,
        mutedKeywords: preferences.mutedKeywords,
        ...('briefingTime' in patch || 'timezone' in patch
          ? { nextBriefingAt: null }
          : {}),
      },
    });
    return this.getRequired(telegramChatId);
  }

  public async setSubscription(
    telegramChatId: bigint,
    rawWatcherBot: unknown,
    enabled: boolean,
  ): Promise<BriefingConfiguration> {
    const watcherBot = watcherBotIdSchema.parse(rawWatcherBot);
    const configuration = await this.ensure(telegramChatId);
    await this.db.briefingSubscription.upsert({
      where: {
        settingsId_watcherBot: {
          settingsId: configuration.settings.id,
          watcherBot: toDatabaseWatcher(watcherBot),
        },
      },
      create: {
        settingsId: configuration.settings.id,
        watcherBot: toDatabaseWatcher(watcherBot),
        enabled,
      },
      update: { enabled },
    });
    return this.getRequired(telegramChatId);
  }

  public async setAllSubscriptions(
    telegramChatId: bigint,
    enabled: boolean,
  ): Promise<BriefingConfiguration> {
    const configuration = await this.ensure(telegramChatId);
    await this.db.briefingSubscription.updateMany({
      where: { settingsId: configuration.settings.id },
      data: { enabled },
    });
    return this.getRequired(telegramChatId);
  }

  public async setOnboardingStep(
    telegramChatId: bigint,
    rawStep: unknown,
  ): Promise<BriefingConfiguration> {
    const step = briefingOnboardingStepSchema.parse(rawStep);
    const configuration = await this.ensure(telegramChatId);
    const completed = step === 'COMPLETE';
    await this.db.$transaction([
      this.db.onboardingState.update({
        where: { settingsId: configuration.settings.id },
        data: { currentStep: onboardingStep(step), completed },
      }),
      this.db.briefingSettings.update({
        where: { id: configuration.settings.id },
        data: {
          onboardingComplete: completed,
          ...(completed ? { nextBriefingAt: null } : {}),
        },
      }),
    ]);
    return this.getRequired(telegramChatId);
  }

  public async setLocation(
    telegramChatId: bigint,
    rawLocation: unknown,
  ): Promise<BriefingConfiguration> {
    const location = briefingLocationInputSchema.parse(rawLocation);
    const configuration = await this.ensure(telegramChatId);
    const data = {
      mode: locationMode(location.mode),
      city: location.city ?? null,
      country: location.country ?? null,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
    };
    await this.db.briefingLocation.upsert({
      where: { settingsId: configuration.settings.id },
      create: { settingsId: configuration.settings.id, ...data },
      update: data,
    });
    return this.getRequired(telegramChatId);
  }

  public clearLocation(telegramChatId: bigint) {
    return this.setLocation(telegramChatId, { mode: 'DISABLED' });
  }

  public async recordFeedback(
    telegramChatId: bigint,
    runId: string,
    rawRating: unknown,
  ): Promise<void> {
    const rating = z
      .enum(['USEFUL', 'NOT_USEFUL', 'TOO_LONG'])
      .parse(rawRating);
    const configuration = await this.ensure(telegramChatId);
    await this.db.$transaction(async (transaction) => {
      const run = await transaction.briefingRun.findFirst({
        where: { id: runId, settingsId: configuration.settings.id },
        select: { id: true },
      });
      if (!run) throw new Error('Briefing run does not belong to this chat');
      const previous = await transaction.briefingFeedback.findUnique({
        where: { runId },
        select: { rating: true },
      });
      await transaction.briefingFeedback.upsert({
        where: { runId },
        create: { settingsId: configuration.settings.id, runId, rating },
        update: { rating },
      });
      if (
        rating === 'TOO_LONG' &&
        previous?.rating !== 'TOO_LONG' &&
        configuration.settings.targetDurationMinutes > 1
      ) {
        const targetDurationMinutes =
          configuration.settings.targetDurationMinutes - 1;
        await transaction.briefingSettings.update({
          where: { id: configuration.settings.id },
          data: {
            targetDurationMinutes,
            maximumDurationMinutes: Math.max(
              targetDurationMinutes,
              configuration.settings.maximumDurationMinutes - 1,
            ),
          },
        });
      }
    });
  }

  private async getRequired(
    telegramChatId: bigint,
  ): Promise<BriefingConfiguration> {
    const configuration = await this.get(telegramChatId);
    if (!configuration) {
      throw new Error(`Briefing settings missing for chat ${telegramChatId}`);
    }
    return configuration;
  }
}
