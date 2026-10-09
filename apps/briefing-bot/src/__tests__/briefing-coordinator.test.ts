import type {
  BriefingConfiguration,
  BriefingRunRecord,
} from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { BriefingCoordinator } from '../briefing-coordinator.js';
import type { BriefingDeliveryInput } from '../delivery.js';
import type { ScriptGenerationInput } from '../script-generator.js';

const now = new Date('2026-09-06T05:00:00.000Z');

const configuration = (
  onboardingCompleted = true,
  locationEnabled = false,
  calendarEnabled = false,
): BriefingConfiguration => ({
  settings: {
    id: 'settings-1',
    telegramChatId: '123',
    onboardingComplete: onboardingCompleted,
    language: 'en',
    voice: 'amy',
    timezone: 'Europe/Prague',
    briefingTime: '07:00',
    targetDurationMinutes: 7,
    maximumDurationMinutes: 15,
    sendTranscript: false,
    calendarEnabled,
    weatherEnabled: true,
    priorityKeywords: [],
    mutedKeywords: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  },
  subscriptions: [
    {
      id: 'sub-1',
      watcherBot: 'stocks',
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  location: {
    id: 'location-1',
    mode: locationEnabled ? 'STATIC' : 'DISABLED',
    ...(locationEnabled
      ? {
          city: 'Brno',
          country: 'CZ',
          latitude: 49.1951,
          longitude: 16.6068,
        }
      : {}),
    updatedAt: now.toISOString(),
  },
  onboarding: {
    completed: onboardingCompleted,
    currentStep: onboardingCompleted ? 'COMPLETE' : 'VOICE',
    updatedAt: now.toISOString(),
  },
});

const runRecord = (
  input: Record<string, unknown>,
  status: BriefingRunRecord['status'] = 'RUNNING',
): BriefingRunRecord => ({
  id: 'run-1',
  telegramChatId: '123',
  idempotencyKey: String(input.idempotencyKey),
  type: input.type as BriefingRunRecord['type'],
  ...(input.scheduledFor instanceof Date
    ? { scheduledFor: input.scheduledFor.toISOString() }
    : {}),
  startedAt: now.toISOString(),
  periodStart: (input.periodStart as Date).toISOString(),
  periodEnd: (input.periodEnd as Date).toISOString(),
  subscriptions: ['stocks'],
  weatherAvailable: false,
  calendarAvailable: false,
  status,
  selectedStoryIds: [],
  targetDurationSeconds: Number(input.targetDurationSeconds),
  maximumDurationSeconds: Number(input.maximumDurationSeconds),
  voice: 'amy',
});

const dependencies = (
  options: {
    ttsFails?: boolean;
    watcherHealth?: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
    watcherLastRunAt?: string;
    onboardingCompleted?: boolean;
    currentTime?: Date;
    locationEnabled?: boolean;
    calendarEnabled?: boolean;
  } = {},
) => {
  const seen = new Map<string, BriefingRunRecord>();
  const starts: Record<string, unknown>[] = [];
  const runs = {
    start: async (_chatId: bigint, rawInput: unknown) => {
      const input = rawInput as Record<string, unknown>;
      starts.push(input);
      const key = String(input.idempotencyKey);
      const existing = seen.get(key);
      if (existing) return { run: existing, created: false };
      const run = runRecord(input);
      seen.set(key, run);
      return { run, created: true };
    },
    complete: vi.fn(async (_runId: string, rawResult: unknown) => {
      const result = rawResult as Record<string, unknown>;
      const current = [...seen.values()][0]!;
      const completed = {
        ...current,
        status: result.status as BriefingRunRecord['status'],
        completedAt: now.toISOString(),
        ...(typeof result.displayScript === 'string'
          ? { displayScript: result.displayScript }
          : {}),
      };
      seen.set(current.idempotencyKey, completed);
      return completed;
    }),
    lastSuccessfulScheduled: vi.fn(
      async (): Promise<BriefingRunRecord | undefined> => undefined,
    ),
  };
  const deliveryInputs: BriefingDeliveryInput[] = [];
  const delivery = {
    deliver: vi.fn(async (input: BriefingDeliveryInput) => {
      deliveryInputs.push(input);
      return {
        status: options.ttsFails ? ('PARTIAL' as const) : ('SUCCESS' as const),
        ...(options.ttsFails ? { fallbackMessageId: 'text-1' } : {}),
        ...(!options.ttsFails ? { voiceMessageId: 'voice-1' } : {}),
        failedChannels: options.ttsFails ? ['VOICE' as const] : [],
      };
    }),
  };
  const tts = {
    generateSpeech: vi.fn(async () => {
      if (options.ttsFails) throw new Error('Piper unavailable');
      return {
        audio: new Uint8Array([1]),
        mimeType: 'audio/ogg' as const,
        fileName: 'briefing.ogg',
        voice: 'amy' as const,
        chunkCount: 1,
        generationDurationMs: 100,
        audioDurationSeconds: 180,
      };
    }),
  };
  return {
    value: {
      configuration: {
        ensure: async () =>
          configuration(
            options.onboardingCompleted ?? true,
            options.locationEnabled ?? false,
            options.calendarEnabled ?? false,
          ),
      },
      runs,
      storyStates: { save: vi.fn() },
      storyEngine: {
        collect: vi.fn(async () => ({
          stories: [],
          metrics: {
            eventsRetrieved: 0,
            clustersCreated: 0,
            duplicateReduction: 0,
            unchangedSuppressed: 0,
            resolvedSuppressed: 0,
            continuityStories: 0,
            selected: 0,
            eventsByWatcher: {
              stocks: 0,
              medical: 0,
              news: 0,
              'mu-clubs': 0,
              'brno-events': 0,
            },
            duplicateReductionByWatcher: {
              stocks: 0,
              medical: 0,
              news: 0,
              'mu-clubs': 0,
              'brno-events': 0,
            },
          },
        })),
      },
      scripts: {
        generate: vi.fn(async (scriptInput: ScriptGenerationInput) => {
          void scriptInput;
          return {
            displayScript: 'Good morning. Nothing new.',
            ttsScript: 'Good morning. Nothing new.',
            ttsSegments: [
              { text: 'Good morning. Nothing new.', language: 'en' as const },
            ],
            wordCount: 4,
            metrics: { llmCallCount: 1, estimatedCostUsd: 0 },
          };
        }),
      },
      tts,
      delivery,
      resources: {
        withExclusiveLease: async <T>(
          _resource: string,
          task: () => Promise<T>,
        ) => task(),
      },
      weather: { forecast: vi.fn() },
      watcherHealth: {
        list: vi.fn(async () => [
          {
            watcherBot: 'stocks' as const,
            status: options.watcherHealth ?? ('HEALTHY' as const),
            lastRunAt: options.watcherLastRunAt ?? now.toISOString(),
            eventsEmitted: 0,
            failedEventPublications: 0,
            sourceFailures: 0,
          },
        ]),
      },
      ttsAttempts: 2,
      now: () => new Date(options.currentTime ?? now),
    },
    starts,
    runs,
    tts,
    delivery,
    deliveryInputs,
  };
};

describe('BriefingCoordinator', () => {
  it('uses the scheduled local month-end for the morning reminder, even after a delayed run', async () => {
    const scheduledFor = new Date('2026-10-31T06:00:00.000Z');
    const setup = dependencies({
      currentTime: new Date('2026-11-01T06:00:00.000Z'),
    });

    await new BriefingCoordinator(setup.value).generate(
      123n,
      'SCHEDULED',
      scheduledFor,
    );

    expect(setup.value.scripts.generate.mock.calls[0]?.[0]).toMatchObject({
      monthEndReminder: true,
      dayPeriod: 'morning',
    });
    expect(setup.deliveryInputs[0]?.index).toMatchObject({
      monthEndReminder: true,
      dateLabel: 'Saturday, October 31',
    });
  });

  it('does not repeat the month-end reminder in the evening briefing', async () => {
    const currentTime = new Date('2026-10-31T19:00:00.000Z');
    const setup = dependencies({ currentTime });

    await new BriefingCoordinator(setup.value).generate(
      123n,
      'SCHEDULED',
      currentTime,
    );

    expect(setup.value.scripts.generate.mock.calls[0]?.[0]).toMatchObject({
      monthEndReminder: false,
      dayPeriod: 'evening',
    });
    expect(setup.deliveryInputs[0]?.index.monthEndReminder).toBe(false);
  });

  it('adds one-week and two-week birthday and name-day reminders on Monday morning', async () => {
    const mondayMorning = new Date('2026-10-05T05:00:00.000Z');
    const setup = dependencies({
      currentTime: mondayMorning,
      calendarEnabled: true,
    });
    const listEvents = vi.fn(
      async (
        _chatId: bigint,
        input: { start: Date; end: Date; timezone: string },
      ) =>
        input.end.getTime() - input.start.getTime() > 24 * 60 * 60_000
          ? [
              {
                id: 'birthday-1',
                title: 'Narozeniny Jany',
                start: '2026-10-15',
                end: '2026-10-16',
                allDay: true,
              },
              {
                id: 'name-day-1',
                title: 'Svátek má Petr',
                start: '2026-10-22',
                end: '2026-10-23',
                allDay: true,
              },
            ]
          : [],
    );

    await new BriefingCoordinator({
      ...setup.value,
      calendar: { listEvents },
    }).generate(123n, 'SCHEDULED', mondayMorning);

    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(setup.value.scripts.generate.mock.calls[0]?.[0]).toMatchObject({
      occasionReminders: {
        status: 'AVAILABLE',
        reminders: [
          { title: 'Narozeniny Jany', leadWeeks: 1 },
          { title: 'Svátek má Petr', leadWeeks: 2 },
        ],
      },
    });
    expect(setup.deliveryInputs[0]?.index).toMatchObject({
      occasionReminders: {
        status: 'AVAILABLE',
        reminders: [
          { title: 'Narozeniny Jany', leadWeeks: 1 },
          { title: 'Svátek má Petr', leadWeeks: 2 },
        ],
      },
    });
  });

  it('does not request the future occasion window outside Monday morning', async () => {
    const tuesdayMorning = new Date('2026-10-06T05:00:00.000Z');
    const setup = dependencies({
      currentTime: tuesdayMorning,
      calendarEnabled: true,
    });
    const listEvents = vi.fn(async () => []);

    await new BriefingCoordinator({
      ...setup.value,
      calendar: { listEvents },
    }).generate(123n, 'SCHEDULED', tuesdayMorning);

    expect(listEvents).toHaveBeenCalledOnce();
    expect(setup.value.scripts.generate.mock.calls[0]?.[0]).toMatchObject({
      occasionReminders: { status: 'DISABLED', reminders: [] },
    });
  });

  it('does not add occasion reminders to a Monday test briefing', async () => {
    const mondayMorning = new Date('2026-10-05T05:00:00.000Z');
    const setup = dependencies({
      currentTime: mondayMorning,
      calendarEnabled: true,
    });
    const listEvents = vi.fn(async () => []);

    await new BriefingCoordinator({
      ...setup.value,
      calendar: { listEvents },
    }).generate(123n, 'TEST');

    expect(listEvents).toHaveBeenCalledOnce();
    expect(setup.value.scripts.generate.mock.calls[0]?.[0]).toMatchObject({
      occasionReminders: { status: 'DISABLED', reminders: [] },
    });
  });

  it.each([
    ['morning', '2026-09-06T05:00:00.000Z'],
    ['evening', '2026-09-06T18:00:00.000Z'],
  ])('adds the goals message after a %s briefing', async (_period, time) => {
    const currentTime = new Date(time);
    const setup = dependencies({ currentTime });
    const goals = {
      list: vi.fn(async () => [
        { id: 7, title: 'Finish my degree', dueOn: '2026-09-16' },
      ]),
    };
    const coordinator = new BriefingCoordinator({ ...setup.value, goals });

    await coordinator.generate(123n, 'SCHEDULED', currentTime);

    expect(goals.list).toHaveBeenCalledWith(123n);
    expect(setup.deliveryInputs[0]?.goalsMessage).toContain(
      '#7 Finish my degree — 16.09.2026 (in 10 days)',
    );
  });

  it('does not append goals to test or afternoon briefings', async () => {
    const goals = { list: vi.fn(async () => []) };
    const afternoon = dependencies({
      currentTime: new Date('2026-09-06T13:00:00.000Z'),
    });
    await new BriefingCoordinator({ ...afternoon.value, goals }).generate(
      123n,
      'SCHEDULED',
      new Date('2026-09-06T13:00:00.000Z'),
    );
    const test = dependencies();
    await new BriefingCoordinator({ ...test.value, goals }).generate(
      123n,
      'TEST',
    );

    expect(goals.list).not.toHaveBeenCalled();
    expect(afternoon.deliveryInputs[0]?.goalsMessage).toBeUndefined();
    expect(test.deliveryInputs[0]?.goalsMessage).toBeUndefined();
  });

  it('keeps briefing delivery working when goal loading fails', async () => {
    const setup = dependencies();
    const goals = {
      list: vi.fn(async () => Promise.reject(new Error('DB unavailable'))),
    };
    const coordinator = new BriefingCoordinator({ ...setup.value, goals });

    const result = await coordinator.generate(123n, 'SCHEDULED', now);

    expect(result.run.status).toBe('PARTIAL');
    expect(setup.deliveryInputs[0]?.goalsMessage).toContain(
      'Goals are temporarily unavailable',
    );
  });

  it('includes watchlist earnings even when there are no new stock stories', async () => {
    const setup = dependencies();
    const list = vi.fn(async () => [
      {
        id: 'earnings-1',
        ticker: 'MU',
        companyName: 'Micron Technology',
        description: 'Quarterly results',
        expectedStart: new Date('2026-09-20T20:00:00.000Z'),
        exactDateKnown: true,
        impact: 'HIGH',
        source: 'COMPANY',
        sourceUrl: 'https://example.com/mu',
      },
    ]);
    const coordinator = new BriefingCoordinator({
      ...setup.value,
      earningsCalendar: { list },
    });

    await coordinator.generate(123n, 'MANUAL');

    expect(list).toHaveBeenCalledOnce();
    const scriptInput = setup.value.scripts.generate.mock.calls[0]?.[0];
    expect(scriptInput?.earnings).toMatchObject({
      status: 'AVAILABLE',
      events: [{ ticker: 'MU', daysUntil: 14 }],
    });
    expect(setup.deliveryInputs[0]?.index).toMatchObject({
      earnings: { status: 'AVAILABLE', events: [{ ticker: 'MU' }] },
      stockNews: [],
    });
  });

  it('allows a manual briefing before optional onboarding is complete', async () => {
    const setup = dependencies({ onboardingCompleted: false });
    const coordinator = new BriefingCoordinator(setup.value);

    const result = await coordinator.generate(123n, 'MANUAL');

    expect(result.run.status).toBe('SUCCESS');
    expect(setup.starts).toHaveLength(1);
  });

  it('keeps scheduled delivery disabled until onboarding is complete', async () => {
    const setup = dependencies({ onboardingCompleted: false });
    const coordinator = new BriefingCoordinator(setup.value);

    await expect(coordinator.generate(123n, 'SCHEDULED', now)).rejects.toThrow(
      'Complete onboarding with /start before enabling scheduled briefings',
    );
    expect(setup.starts).toHaveLength(0);
  });

  it('delivers a scheduled occurrence once and uses the prior scheduled window', async () => {
    const setup = dependencies();
    setup.runs.lastSuccessfulScheduled.mockResolvedValue({
      ...runRecord({
        idempotencyKey: 'previous',
        type: 'SCHEDULED',
        periodStart: new Date('2026-09-04T05:00:00.000Z'),
        periodEnd: new Date('2026-09-05T05:30:00.000Z'),
        targetDurationSeconds: 420,
        maximumDurationSeconds: 900,
      }),
      status: 'SUCCESS',
      periodEnd: '2026-09-05T05:30:00.000Z',
    });
    const coordinator = new BriefingCoordinator(setup.value);
    const occurrence = new Date('2026-09-06T05:00:00.000Z');

    const first = await coordinator.generate(123n, 'SCHEDULED', occurrence);
    const duplicate = await coordinator.generate(123n, 'SCHEDULED', occurrence);

    expect(first).toMatchObject({
      duplicate: false,
      run: { status: 'SUCCESS' },
    });
    expect(duplicate).toMatchObject({ duplicate: true });
    expect(setup.starts[0]?.periodStart).toEqual(
      new Date('2026-09-05T05:30:00.000Z'),
    );
    expect(setup.delivery.deliver).toHaveBeenCalledTimes(1);
    expect(setup.tts.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [{ text: 'Good morning. Nothing new.', language: 'en' }],
      }),
    );
  });

  it('uses the explicit weekly scheduled window and keeps daily slots independent', async () => {
    const setup = dependencies();
    setup.runs.lastSuccessfulScheduled.mockResolvedValue({
      ...runRecord({
        idempotencyKey: 'previous',
        type: 'SCHEDULED',
        periodStart: new Date('2026-09-04T05:00:00.000Z'),
        periodEnd: new Date('2026-09-05T05:30:00.000Z'),
        targetDurationSeconds: 420,
        maximumDurationSeconds: 900,
      }),
      status: 'SUCCESS',
      periodEnd: '2026-09-05T05:30:00.000Z',
    });
    const coordinator = new BriefingCoordinator(setup.value);

    await coordinator.generate(
      123n,
      'SCHEDULED',
      new Date('2026-09-06T05:00:00.000Z'),
      undefined,
      { scheduleKey: 'weekly:SUN:07:00', periodHours: 168 },
    );
    await coordinator.generate(
      123n,
      'SCHEDULED',
      new Date('2026-09-06T18:00:00.000Z'),
      undefined,
      { scheduleKey: 'daily:20:00' },
    );

    expect(setup.starts[0]?.periodStart).toEqual(
      new Date('2026-08-30T05:00:00.000Z'),
    );
    expect(setup.starts.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      'briefing:123:weekly:SUN:07:00:2026-09-06:07:00',
      'briefing:123:daily:20:00:2026-09-06:20:00',
    ]);
    expect(setup.delivery.deliver).toHaveBeenCalledTimes(2);
  });

  it('keeps manual windows independent and retries Piper before text fallback', async () => {
    const setup = dependencies({ ttsFails: true });
    const coordinator = new BriefingCoordinator(setup.value);

    const result = await coordinator.generate(123n, 'MANUAL');

    expect(result.run.status).toBe('PARTIAL');
    expect(setup.starts[0]?.periodStart).toEqual(
      new Date('2026-09-05T05:00:00.000Z'),
    );
    expect(setup.runs.lastSuccessfulScheduled).not.toHaveBeenCalled();
    expect(setup.tts.generateSpeech).toHaveBeenCalledTimes(2);
    expect(setup.deliveryInputs[0]).not.toHaveProperty('audio');
  });

  it('uses the local day for evening updates and prepares tomorrow', async () => {
    const evening = new Date('2026-09-06T18:00:00.000Z');
    const setup = dependencies({ currentTime: evening });
    const coordinator = new BriefingCoordinator(setup.value);

    await coordinator.generate(123n, 'MANUAL');

    expect(setup.starts[0]?.periodStart).toEqual(
      new Date('2026-09-05T22:00:00.000Z'),
    );
    expect(setup.value.storyEngine.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: new Date('2026-09-05T22:00:00.000Z'),
        periodEnd: evening,
      }),
    );
    const scriptInput = setup.value.scripts.generate.mock.calls[0]?.[0];
    expect(scriptInput?.dayPeriod).toBe('evening');
    expect(scriptInput?.calendar.day).toBe('tomorrow');
  });

  it("requests tomorrow's weather for the scheduled evening slot even when posting is delayed", async () => {
    const scheduledFor = new Date('2026-09-06T18:00:00.000Z');
    const setup = dependencies({
      currentTime: new Date('2026-09-06T22:30:00.000Z'),
      locationEnabled: true,
    });
    const coordinator = new BriefingCoordinator(setup.value);

    await coordinator.generate(123n, 'SCHEDULED', scheduledFor);

    expect(setup.value.weather.forecast).toHaveBeenCalledWith(
      49.1951,
      16.6068,
      'Europe/Prague',
      expect.any(AbortSignal),
      { date: '2026-09-07', label: 'tomorrow' },
    );
    const scriptInput = setup.value.scripts.generate.mock.calls[0]?.[0];
    expect(scriptInput?.dayPeriod).toBe('evening');
    expect(scriptInput?.calendar.day).toBe('tomorrow');
  });

  it('marks a briefing partial and persists reduced coverage for a degraded watcher', async () => {
    const setup = dependencies({ watcherHealth: 'DEGRADED' });
    const coordinator = new BriefingCoordinator(setup.value);

    const result = await coordinator.generate(123n, 'MANUAL');

    expect(result.run.status).toBe('PARTIAL');
    expect(setup.runs.complete).toHaveBeenCalledWith(
      'run-1',
      expect.anything(),
    );
    const completion: unknown = setup.runs.complete.mock.calls.at(-1)?.[1];
    expect(completion).toMatchObject({
      status: 'PARTIAL',
      briefingDataCoverage: 50,
      metrics: {
        watcherHealth: {
          stocks: 'DEGRADED',
          medical: 'UNAVAILABLE',
          news: 'UNAVAILABLE',
          'mu-clubs': 'UNAVAILABLE',
        },
        dataCoverage: 50,
        failedDeliveries: 0,
      },
    });
  });

  it('postpones scheduled output until a stale producer completes its requested run', async () => {
    const setup = dependencies({
      watcherLastRunAt: '2026-09-06T01:00:00.000Z',
    });
    const staleHealth = {
      watcherBot: 'stocks' as const,
      status: 'HEALTHY' as const,
      lastRunAt: '2026-09-06T01:00:00.000Z',
      eventsEmitted: 0,
      failedEventPublications: 0,
      sourceFailures: 0,
    };
    const freshHealth = {
      ...staleHealth,
      lastRunAt: '2026-09-06T04:45:00.000Z',
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce([staleHealth])
      .mockResolvedValueOnce([freshHealth])
      .mockResolvedValueOnce([freshHealth]);
    const trigger = vi.fn(async () => ({
      status: 'QUEUED' as const,
      message: 'queued',
    }));
    const coordinator = new BriefingCoordinator({
      ...setup.value,
      watcherHealth: { list },
      watcherTrigger: { trigger },
      freshness: {
        maximumAgeMs: 60 * 60_000,
        maximumWaitMs: 10_000,
        pollIntervalMs: 1_000,
      },
      sleep: vi.fn(async () => undefined),
    });

    const result = await coordinator.generate(123n, 'SCHEDULED', now);

    expect(result.run.status).toBe('SUCCESS');
    expect(trigger).toHaveBeenCalledWith(123n, 'stocks');
    expect(list).toHaveBeenCalledTimes(3);
    expect(setup.value.scripts.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        dataQuality: [],
      }),
    );
    const completion: unknown = setup.runs.complete.mock.calls.at(-1)?.[1];
    expect(completion).toMatchObject({
      metrics: { watcherHealth: { stocks: 'HEALTHY' } },
    });
  });

  it('delivers a scheduled briefing and goals when a producer remains stale', async () => {
    const setup = dependencies({
      watcherLastRunAt: '2026-09-06T01:00:00.000Z',
    });
    const goals = {
      list: vi.fn(async () => [
        { id: 7, title: 'Finish my degree', dueOn: '2026-09-16' },
      ]),
    };
    const coordinator = new BriefingCoordinator({
      ...setup.value,
      goals,
      freshness: {
        maximumAgeMs: 60 * 60_000,
        maximumWaitMs: 0,
        pollIntervalMs: 1_000,
      },
    });

    const result = await coordinator.generate(123n, 'SCHEDULED', now);

    expect(result.run.status).toBe('PARTIAL');
    expect(setup.delivery.deliver).toHaveBeenCalledOnce();
    expect(setup.deliveryInputs[0]?.goalsMessage).toContain('Finish my degree');
    expect(setup.value.scripts.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        dataQuality: [
          'stocks watcher has not completed a recent scan; older stored events were still considered.',
        ],
      }),
    );
    const completion: unknown = setup.runs.complete.mock.calls.at(-1)?.[1];
    expect(completion).toMatchObject({
      metrics: { watcherHealth: { stocks: 'DEGRADED' } },
    });
  });
});
