import type {
  BriefingConfiguration,
  BriefingRunRecord,
} from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { BriefingCoordinator } from '../briefing-coordinator.js';
import type { BriefingDeliveryInput } from '../delivery.js';

const now = new Date('2026-09-06T05:00:00.000Z');

const configuration = (): BriefingConfiguration => ({
  settings: {
    id: 'settings-1',
    telegramChatId: '123',
    onboardingComplete: true,
    language: 'en',
    voice: 'amy',
    timezone: 'Europe/Prague',
    briefingTime: '07:00',
    targetDurationMinutes: 7,
    maximumDurationMinutes: 15,
    sendTranscript: false,
    calendarEnabled: false,
    weatherEnabled: true,
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
    mode: 'DISABLED',
    updatedAt: now.toISOString(),
  },
  onboarding: {
    completed: true,
    currentStep: 'COMPLETE',
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
      configuration: { ensure: async () => configuration() },
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
            eventsByWatcher: { stocks: 0, medical: 0 },
            duplicateReductionByWatcher: { stocks: 0, medical: 0 },
          },
        })),
      },
      scripts: {
        generate: vi.fn(async () => ({
          displayScript: 'Good morning. Nothing new.',
          ttsScript: 'Good morning. Nothing new.',
          ttsSegments: [
            { text: 'Good morning. Nothing new.', language: 'en' as const },
          ],
          wordCount: 4,
          metrics: { llmCallCount: 1, estimatedCostUsd: 0 },
        })),
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
            lastRunAt: now.toISOString(),
            eventsEmitted: 0,
            failedEventPublications: 0,
            sourceFailures: 0,
          },
        ]),
      },
      ttsAttempts: 2,
      now: () => new Date(now),
    },
    starts,
    runs,
    tts,
    delivery,
    deliveryInputs,
  };
};

describe('BriefingCoordinator', () => {
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
        watcherHealth: { stocks: 'DEGRADED', medical: 'UNAVAILABLE' },
        dataCoverage: 50,
        failedDeliveries: 0,
      },
    });
  });
});
