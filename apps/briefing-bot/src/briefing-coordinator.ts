import { randomUUID } from 'node:crypto';
import type { WatcherLogger } from '@watcher/core';
import type {
  BriefingConfigurationStore,
  BriefingRunRecord,
  BriefingRunStore,
  BriefingStoryStore,
  BriefingWatcherHealthStore,
  ResourceLeaseStore,
} from '@watcher/database';
import {
  buildBriefingRunMetrics,
  calculateBriefingCoverage,
} from './briefing-observability.js';
import {
  planBriefingDuration,
  selectStoriesForBudget,
} from './briefing-duration.js';
import {
  dateLabel,
  dateParts,
  loadBriefingCalendar,
  loadBriefingWeather,
  locationLabel,
  measured,
  type CalendarProvider,
} from './briefing-context.js';
import {
  calendarActionInsights,
  calendarDayWindow,
  renderCalendarSummary,
} from './calendar.js';
import type {
  BriefingDeliveryResult,
  BriefingDeliveryService,
} from './delivery.js';
import {
  fallbackBriefingScript,
  type BriefingScriptGenerator,
  type GeneratedBriefingScript,
} from './script-generator.js';
import type { StoryEngine } from './story-engine.js';
import type { StoryEngineMetrics } from './story-types.js';
import type { TtsProvider, TtsResult } from './tts.js';
import {
  briefingDayPeriodFor,
  isEndOfDayBriefing,
} from './utils/day-period.js';
import type { WeatherProvider } from './weather.js';
import { renderSpokenWeather } from './weather.js';
import { waitForFreshWatcherRuns } from './briefing-freshness.js';

type ConfigurationStore = Pick<BriefingConfigurationStore, 'ensure'>;
type RunStore = Pick<
  BriefingRunStore,
  'start' | 'complete' | 'lastSuccessfulScheduled'
>;
type StoryStates = Pick<BriefingStoryStore, 'save'>;
type ResourceLeases = Pick<ResourceLeaseStore, 'withExclusiveLease'>;
type WatcherHealth = Pick<BriefingWatcherHealthStore, 'list'>;

export type BriefingRunTrigger = 'SCHEDULED' | 'MANUAL' | 'TEST';
export type BriefingProgress = (step: string, percent: number) => Promise<void>;
export type BriefingScheduleContext = {
  scheduleKey?: string;
  periodHours?: number;
};

export type BriefingCoordinatorResult = {
  run: BriefingRunRecord;
  duplicate: boolean;
  delivery?: BriefingDeliveryResult;
  storyMetrics?: StoryEngineMetrics;
};

export class BriefingCoordinator {
  public constructor(
    private readonly dependencies: {
      configuration: ConfigurationStore;
      runs: RunStore;
      storyStates: StoryStates;
      storyEngine: Pick<StoryEngine, 'collect'>;
      scripts: Pick<BriefingScriptGenerator, 'generate'>;
      tts: TtsProvider;
      delivery: Pick<BriefingDeliveryService, 'deliver'>;
      resources: ResourceLeases;
      weather: WeatherProvider;
      watcherHealth: WatcherHealth;
      calendar?: CalendarProvider;
      logger?: WatcherLogger;
      ttsAttempts?: number;
      freshness?: {
        maximumAgeMs: number;
        timeoutMs: number;
        pollIntervalMs: number;
      };
      sleep?: (milliseconds: number) => Promise<void>;
      now?: () => Date;
    },
  ) {}

  public async generate(
    telegramChatId: bigint,
    type: BriefingRunTrigger,
    scheduledFor?: Date,
    progress: BriefingProgress = () => Promise.resolve(),
    scheduleContext: BriefingScheduleContext = {},
  ): Promise<BriefingCoordinatorResult> {
    const runStartedAt = Date.now();
    let now = this.dependencies.now?.() ?? new Date();
    this.dependencies.logger?.info(
      {
        telegramChatId: telegramChatId.toString(),
        runType: type,
        scheduledFor: scheduledFor?.toISOString(),
        scheduleKey: scheduleContext.scheduleKey,
      },
      'Briefing run requested',
    );
    const configuration =
      await this.dependencies.configuration.ensure(telegramChatId);
    if (type === 'SCHEDULED' && !configuration.onboarding.completed) {
      throw new Error(
        'Complete onboarding with /start before enabling scheduled briefings',
      );
    }
    if (type !== 'SCHEDULED' && !configuration.onboarding.completed) {
      this.dependencies.logger?.info(
        {
          telegramChatId: telegramChatId.toString(),
          runType: type,
          onboardingStep: configuration.onboarding.currentStep,
        },
        'Generating briefing with saved and default settings before onboarding completion',
      );
    }
    const subscriptions = configuration.subscriptions
      .filter(({ enabled }) => enabled)
      .map(({ watcherBot }) => watcherBot);
    if (type === 'SCHEDULED' && this.dependencies.freshness) {
      await progress('Waiting for fresh watcher data', 5);
      await waitForFreshWatcherRuns({
        watcherHealth: this.dependencies.watcherHealth,
        subscriptions,
        referenceTime: scheduledFor ?? now,
        maximumAgeMs: this.dependencies.freshness.maximumAgeMs,
        timeoutMs: this.dependencies.freshness.timeoutMs,
        pollIntervalMs: this.dependencies.freshness.pollIntervalMs,
        ...(this.dependencies.sleep ? { sleep: this.dependencies.sleep } : {}),
        ...(this.dependencies.logger
          ? { logger: this.dependencies.logger }
          : {}),
      });
      now = this.dependencies.now?.() ?? new Date();
    }
    const periodEnd = now;
    const local = dateParts(now, configuration.settings.timezone);
    const dayPeriod = briefingDayPeriodFor(local.time);
    const endOfDay = isEndOfDayBriefing(dayPeriod);
    const previous =
      type === 'SCHEDULED'
        ? await this.dependencies.runs.lastSuccessfulScheduled(telegramChatId)
        : undefined;
    const explicitPeriodHours =
      type === 'SCHEDULED' ? scheduleContext.periodHours : undefined;
    const periodStart =
      explicitPeriodHours === undefined
        ? endOfDay
          ? calendarDayWindow(now, configuration.settings.timezone).start
          : previous
            ? new Date(previous.periodEnd)
            : new Date(periodEnd.getTime() - 24 * 60 * 60_000)
        : new Date(periodEnd.getTime() - explicitPeriodHours * 60 * 60_000);
    const scheduleIdentity = scheduledFor ?? now;
    const place = configuration.location
      ? locationLabel(configuration.location)
      : undefined;
    const idempotencyKey =
      type === 'SCHEDULED'
        ? `briefing:${telegramChatId}:${scheduleContext.scheduleKey ?? 'scheduled'}:${dateParts(scheduleIdentity, configuration.settings.timezone).date}:${dateParts(scheduleIdentity, configuration.settings.timezone).time}`
        : `briefing:${type.toLowerCase()}:${telegramChatId}:${randomUUID()}`;
    const targetMinutes =
      type === 'TEST'
        ? Math.min(3, configuration.settings.targetDurationMinutes)
        : configuration.settings.targetDurationMinutes;
    const maximumMinutes =
      type === 'TEST'
        ? Math.max(
            targetMinutes,
            Math.min(5, configuration.settings.maximumDurationMinutes),
          )
        : configuration.settings.maximumDurationMinutes;
    const started = await this.dependencies.runs.start(telegramChatId, {
      idempotencyKey,
      type,
      ...(type === 'SCHEDULED' ? { scheduledFor: scheduleIdentity } : {}),
      periodStart,
      periodEnd,
      subscriptions,
      ...(configuration.location?.mode !== 'DISABLED'
        ? {
            location: {
              ...(configuration.location?.city
                ? { city: configuration.location.city }
                : {}),
              ...(configuration.location?.latitude === undefined
                ? {}
                : { latitude: configuration.location.latitude }),
              ...(configuration.location?.longitude === undefined
                ? {}
                : { longitude: configuration.location.longitude }),
            },
          }
        : {}),
      targetDurationSeconds: targetMinutes * 60,
      maximumDurationSeconds: maximumMinutes * 60,
      voice: configuration.settings.voice,
    });
    if (!started.created) {
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          telegramChatId: telegramChatId.toString(),
          runType: type,
          runStatus: started.run.status,
        },
        'Duplicate briefing run skipped',
      );
      return { run: started.run, duplicate: true };
    }

    this.dependencies.logger?.info(
      {
        briefingRunId: started.run.id,
        telegramChatId: telegramChatId.toString(),
        runType: type,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        subscriptions,
        timezone: configuration.settings.timezone,
        weatherEnabled: configuration.settings.weatherEnabled,
        calendarEnabled: configuration.settings.calendarEnabled,
        targetMinutes,
        maximumMinutes,
        voice: configuration.settings.voice,
      },
      'Briefing run started',
    );

    try {
      await progress('Loading weather, calendar, and watcher events', 15);
      this.dependencies.logger?.info(
        { briefingRunId: started.run.id },
        'Loading briefing context and watcher events',
      );
      const [weatherResult, calendarResult, storiesResult, watcherHealth] =
        await Promise.all([
          measured(() =>
            loadBriefingWeather(
              configuration,
              this.dependencies.weather,
              this.dependencies.logger,
            ),
          ),
          measured(() =>
            loadBriefingCalendar(
              telegramChatId,
              configuration,
              this.dependencies.calendar,
              this.dependencies.logger,
              now,
              endOfDay ? 1 : 0,
            ),
          ),
          measured(() =>
            this.dependencies.storyEngine.collect({
              telegramChatId,
              subscriptions,
              periodStart,
              periodEnd,
              priorityKeywords: configuration.settings.priorityKeywords,
              mutedKeywords: configuration.settings.mutedKeywords,
              includePreviouslyMentioned: endOfDay,
            }),
          ),
          this.dependencies.watcherHealth.list(subscriptions),
        ]);
      const weather = weatherResult.value;
      const calendar = calendarResult.value;
      const storyResult = storiesResult.value;
      const coverage = calculateBriefingCoverage({
        subscriptions,
        watcherHealth,
        weather: weather.status,
        calendar: calendar.status,
        now,
        ...(type === 'SCHEDULED' && this.dependencies.freshness
          ? {
              watcherStaleAfterMs: this.dependencies.freshness.maximumAgeMs,
            }
          : {}),
      });
      const duration = planBriefingDuration({
        stories: storyResult.stories,
        targetMinutes,
        maximumMinutes,
        voice: configuration.settings.voice,
        weatherAvailable: weather.status === 'AVAILABLE',
        calendarEventCount: calendar.value.length,
      });
      const selectedStories = selectStoriesForBudget(
        storyResult.stories,
        duration.wordBudget,
      );
      const calendarInsights = calendarActionInsights(calendar.value);
      const actionAgenda = [
        ...calendarInsights,
        ...selectedStories.flatMap(({ actionItems }) => actionItems),
      ].slice(0, 5);
      const dataQuality = coverage.components.flatMap((component) => {
        if (
          component.id === 'weather' ||
          component.id === 'calendar' ||
          component.status === 'HEALTHY'
        ) {
          return [];
        }
        const label = component.id.replace('-', ' ');
        return [
          component.status === 'STALE'
            ? `${label} watcher has not completed a recent scan; older stored events were still considered.`
            : component.status === 'UNAVAILABLE'
              ? `${label} data is currently unavailable.`
              : `${label} data is partially available.`,
        ];
      });
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          weatherStatus: weather.status,
          weatherDurationMs: weatherResult.durationMs,
          calendarStatus: calendar.status,
          calendarEventCount: calendar.value.length,
          calendarDurationMs: calendarResult.durationMs,
          watcherEventsDurationMs: storiesResult.durationMs,
          storyMetrics: storyResult.metrics,
          selectedStoryCount: selectedStories.length,
          coveragePercent: coverage.percentage,
          plannedMinutes: duration.plannedMinutes,
          wordBudget: duration.wordBudget,
          maximumWords: duration.maximumWords,
        },
        'Briefing inputs prepared',
      );
      const scriptInput = {
        date: dateLabel(now, configuration.settings.timezone),
        localTime: local.time,
        dayPeriod,
        timezone: configuration.settings.timezone,
        ...(place ? { location: place } : {}),
        weather: {
          status: weather.status,
          ...(weather.value
            ? {
                spokenSummary: renderSpokenWeather(
                  weather.value,
                  configuration.location?.city,
                ),
              }
            : {}),
        },
        calendar: {
          status: calendar.status,
          day: endOfDay ? 'tomorrow' : 'today',
          events: calendar.value,
          insights: calendarInsights,
          ...(calendar.status === 'AVAILABLE'
            ? {
                spokenSummary: renderCalendarSummary(
                  calendar.value,
                  endOfDay ? 'tomorrow' : 'today',
                ),
              }
            : {}),
        },
        stories: selectedStories,
        actionAgenda,
        dataQuality,
        targetDurationMinutes: duration.plannedMinutes,
        maximumDurationMinutes: maximumMinutes,
        wordBudget: duration.wordBudget,
        maximumWords: duration.maximumWords,
      } as const;

      await progress('Writing the spoken briefing', 45);
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          selectedStoryCount: selectedStories.length,
          wordBudget: duration.wordBudget,
        },
        'Generating briefing script',
      );
      const scriptStartedAt = Date.now();
      let scriptDegraded = false;
      let script: GeneratedBriefingScript;
      try {
        script = await this.dependencies.resources.withExclusiveLease(
          'HEAVY_LOCAL_MODEL',
          () => this.dependencies.scripts.generate(scriptInput),
        );
      } catch (error) {
        scriptDegraded = true;
        this.dependencies.logger?.warn(
          { err: error, briefingRunId: started.run.id },
          'Briefing script model failed; using deterministic fallback',
        );
        script = fallbackBriefingScript(scriptInput);
      }
      const scriptDurationMs = Date.now() - scriptStartedAt;
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          durationMs: scriptDurationMs,
          wordCount: script.wordCount,
          segmentCount: script.ttsSegments.length,
          degraded: scriptDegraded,
        },
        'Briefing script generated',
      );

      await progress('Generating voice audio', 70);
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          voice: configuration.settings.voice,
          segmentCount: script.ttsSegments.length,
        },
        'Generating briefing audio',
      );
      let audio: TtsResult | undefined;
      let ttsFailure: string | undefined;
      const ttsStartedAt = Date.now();
      try {
        audio = await this.generateAudio(
          script.ttsScript,
          script.ttsSegments,
          configuration.settings.voice,
          started.run.id,
        );
      } catch (error) {
        ttsFailure = error instanceof Error ? error.message : String(error);
        this.dependencies.logger?.error(
          { err: error, briefingRunId: started.run.id },
          'Piper failed; delivering text fallback',
        );
      }
      const ttsDurationMs = Date.now() - ttsStartedAt;
      if (audio) {
        this.dependencies.logger?.info(
          {
            briefingRunId: started.run.id,
            durationMs: ttsDurationMs,
            generationDurationMs: audio.generationDurationMs,
            audioDurationSeconds: audio.audioDurationSeconds,
            chunkCount: audio.chunkCount,
            voice: audio.voice,
          },
          'Briefing audio generated',
        );
      }

      await progress('Delivering to Telegram', 90);
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          hasAudio: Boolean(audio),
          sendTranscript: configuration.settings.sendTranscript,
        },
        'Delivering briefing to Telegram',
      );
      const deliveryStartedAt = Date.now();
      const delivery = await this.dependencies.delivery.deliver({
        runId: started.run.id,
        telegramChatId: telegramChatId.toString(),
        ...(audio ? { audio } : {}),
        index: {
          dateLabel: dateLabel(now, configuration.settings.timezone),
          dayPeriod,
          ...(place ? { location: place } : {}),
          calendar: { status: calendar.status, count: calendar.value.length },
          topics: selectedStories.map(({ sourceUrls, title }) => ({
            title,
            ...(sourceUrls[0] ? { url: sourceUrls[0] } : {}),
          })),
        },
        displayScript: script.displayScript,
        sendTranscript: configuration.settings.sendTranscript,
      });
      const telegramUploadDurationMs = Date.now() - deliveryStartedAt;
      this.dependencies.logger?.info(
        {
          briefingRunId: started.run.id,
          durationMs: telegramUploadDurationMs,
          deliveryStatus: delivery.status,
          failedChannels: delivery.failedChannels,
        },
        'Briefing delivery finished',
      );
      const runMetrics = buildBriefingRunMetrics({
        storyMetrics: storyResult.metrics,
        selectedStories,
        coverage,
        latencyMs: {
          weather: weatherResult.durationMs,
          calendar: calendarResult.durationMs,
          watcherEvents: storiesResult.durationMs,
          script: scriptDurationMs,
          ...(audio
            ? { piper: audio.generationDurationMs }
            : { piper: ttsDurationMs }),
          telegramUpload: telegramUploadDurationMs,
        },
        failedDeliveries: delivery.failedChannels.length,
        voice: configuration.settings.voice,
        targetDurationSeconds: targetMinutes * 60,
        maximumDurationSeconds: maximumMinutes * 60,
        plannedDurationSeconds: duration.plannedMinutes * 60,
        ...(audio
          ? { actualAudioDurationSeconds: audio.audioDurationSeconds }
          : {}),
        wordCount: script.wordCount,
      });
      for (const [watcherBot, metrics] of Object.entries(runMetrics.noise)) {
        if (metrics.flaggedForTuning) {
          this.dependencies.logger?.warn(
            { watcherBot, ...metrics, briefingRunId: started.run.id },
            'Briefing producer flagged for low-value event volume',
          );
        }
      }
      const contextDegraded =
        weather.status === 'UNAVAILABLE' ||
        calendar.status === 'UNAVAILABLE' ||
        coverage.percentage < 100;
      const status =
        delivery.status === 'FAILED'
          ? 'FAILED'
          : delivery.status === 'PARTIAL' ||
              scriptDegraded ||
              Boolean(ttsFailure) ||
              contextDegraded
            ? 'PARTIAL'
            : 'SUCCESS';
      if (delivery.status !== 'FAILED') {
        await Promise.all(
          selectedStories.map((story) =>
            this.dependencies.storyStates.save(telegramChatId, {
              storyId: story.id,
              mentionedAt: now,
              summary: story.summary,
              importance: story.importance,
              status: story.status,
              lastBriefingRunId: started.run.id,
            }),
          ),
        );
      }
      const completed = await this.dependencies.runs.complete(started.run.id, {
        status,
        weatherAvailable: weather.status === 'AVAILABLE',
        calendarAvailable: calendar.status === 'AVAILABLE',
        selectedStoryIds: selectedStories.map(({ id }) => id),
        displayScript: script.displayScript,
        ttsScript: script.ttsScript,
        wordCount: script.wordCount,
        ...(audio
          ? { actualAudioDurationSeconds: audio.audioDurationSeconds }
          : {}),
        ...(delivery.voiceMessageId || delivery.fallbackMessageId
          ? {
              telegramMessageId:
                delivery.voiceMessageId ?? delivery.fallbackMessageId,
            }
          : {}),
        ...(status === 'FAILED' || ttsFailure
          ? {
              failureReason:
                ttsFailure ??
                `Telegram delivery failed: ${delivery.failedChannels.join(', ')}`,
            }
          : {}),
        briefingDataCoverage: coverage.percentage,
        metrics: runMetrics,
      });
      await progress('Briefing complete', 100);
      this.dependencies.logger?.info(
        {
          briefingRunId: completed.id,
          runType: type,
          runStatus: completed.status,
          storyMetrics: storyResult.metrics,
          wordCount: script.wordCount,
          audioDurationSeconds: audio?.audioDurationSeconds,
          voice: configuration.settings.voice,
          watcherHealth: runMetrics.watcherHealth,
          briefingDataCoverage: coverage.percentage,
          briefingMetrics: runMetrics,
          totalDurationMs: Date.now() - runStartedAt,
        },
        'Briefing run completed',
      );
      return {
        run: completed,
        duplicate: false,
        delivery,
        storyMetrics: storyResult.metrics,
      };
    } catch (error) {
      await this.dependencies.runs.complete(started.run.id, {
        status: 'FAILED',
        failureReason: error instanceof Error ? error.message : String(error),
      });
      this.dependencies.logger?.error(
        {
          err: error,
          briefingRunId: started.run.id,
          runType: type,
          totalDurationMs: Date.now() - runStartedAt,
        },
        'Briefing run failed',
      );
      throw error;
    }
  }

  private async generateAudio(
    text: string,
    segments: GeneratedBriefingScript['ttsSegments'],
    voice: 'amy' | 'hfc_female' | 'hfc_male',
    briefingRunId: string,
  ): Promise<TtsResult> {
    let failure: unknown;
    const attempts = Math.max(1, this.dependencies.ttsAttempts ?? 2);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.dependencies.logger?.debug(
          { briefingRunId, attempt: attempt + 1, maximumAttempts: attempts },
          'Starting Piper TTS attempt',
        );
        return await this.dependencies.resources.withExclusiveLease(
          'HEAVY_LOCAL_MODEL',
          () =>
            this.dependencies.tts.generateSpeech({
              text,
              language: 'en',
              voice,
              segments,
            }),
        );
      } catch (error) {
        failure = error;
        this.dependencies.logger?.warn(
          {
            err: error,
            briefingRunId,
            attempt: attempt + 1,
            maximumAttempts: attempts,
          },
          'Piper TTS attempt failed',
        );
      }
    }
    throw failure instanceof Error
      ? failure
      : new Error('Piper speech generation failed');
  }
}
