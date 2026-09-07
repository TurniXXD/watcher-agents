import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BriefingConfigurationStore } from '../briefing-configuration-store.js';
import { BriefingDeliveryStore } from '../briefing-delivery-store.js';
import { BriefingRunStore } from '../briefing-run-store.js';
import { BriefingScheduleStore } from '../briefing-schedule-store.js';
import { defaultBriefingScheduleSpec } from '../briefing-schedule-spec.js';
import { BriefingStoryStore } from '../briefing-story-store.js';
import { BriefingWatcherHealthStore } from '../briefing-watcher-health-store.js';
import { CalendarIntegrationStore } from '../calendar-integration-store.js';
import { createDatabaseClient } from '../client.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('briefing persistent state', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const configuration = new BriefingConfigurationStore(database);
  const runs = new BriefingRunStore(database);
  const schedules = new BriefingScheduleStore(database);
  const stories = new BriefingStoryStore(database);
  const calendar = new CalendarIntegrationStore(database);
  const deliveries = new BriefingDeliveryStore(database);
  const watcherHealth = new BriefingWatcherHealthStore(database);

  beforeEach(async () => {
    await database.briefingWatcherHealth.deleteMany();
    await database.calendarIntegrationState.deleteMany();
    await database.briefingStoryState.deleteMany();
    await database.briefingRun.deleteMany();
    await database.onboardingState.deleteMany();
    await database.briefingLocation.deleteMany();
    await database.briefingSubscription.deleteMany();
    await database.briefingSettings.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('creates safe defaults and every real watcher subscription', async () => {
    const first = await configuration.ensure(101n);
    const second = await configuration.ensure(101n);

    expect(first.settings).toMatchObject({
      telegramChatId: '101',
      language: 'en',
      voice: 'amy',
      timezone: 'Europe/Prague',
      briefingTime: defaultBriefingScheduleSpec,
      targetDurationMinutes: 7,
      maximumDurationMinutes: 15,
      sendTranscript: false,
      calendarEnabled: false,
      weatherEnabled: true,
      priorityKeywords: [],
      mutedKeywords: [],
    });
    expect(first.subscriptions).toMatchObject([
      { watcherBot: 'medical', enabled: true },
      { watcherBot: 'mu-clubs', enabled: true },
      { watcherBot: 'news', enabled: true },
      { watcherBot: 'stocks', enabled: true },
    ]);
    expect(second.settings.id).toBe(first.settings.id);
    expect(await database.briefingSubscription.count()).toBe(4);
  });

  it('validates settings as one consistent aggregate', async () => {
    const updated = await configuration.updateSettings(102n, {
      voice: 'hfc_female',
      timezone: 'America/New_York',
      briefingTime: '06:45',
      targetDurationMinutes: 10,
      maximumDurationMinutes: 12,
      priorityKeywords: ['Micron', 'CRISPR'],
      mutedKeywords: ['football'],
    });
    expect(updated.settings).toMatchObject({
      voice: 'hfc_female',
      timezone: 'America/New_York',
      briefingTime: '06:45',
      targetDurationMinutes: 10,
      maximumDurationMinutes: 12,
      priorityKeywords: ['Micron', 'CRISPR'],
      mutedKeywords: ['football'],
    });
    await expect(
      configuration.updateSettings(102n, {
        targetDurationMinutes: 20,
        maximumDurationMinutes: 10,
      }),
    ).rejects.toThrow(/Maximum duration/);
    await expect(
      configuration.updateSettings(102n, { timezone: 'Mars/Olympus' }),
    ).rejects.toThrow(/Invalid timezone/);
  });

  it('records owned-run feedback and shortens future briefings on request', async () => {
    const run = await runs.start(109n, {
      idempotencyKey: 'manual:109:feedback',
      type: 'MANUAL',
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T05:00:00.000Z'),
      subscriptions: ['stocks'],
      targetDurationSeconds: 420,
      maximumDurationSeconds: 900,
    });

    await configuration.recordFeedback(109n, run.run.id, 'TOO_LONG');
    await configuration.recordFeedback(109n, run.run.id, 'TOO_LONG');

    expect((await configuration.get(109n))?.settings).toMatchObject({
      targetDurationMinutes: 6,
      maximumDurationMinutes: 14,
    });
    await expect(
      configuration.recordFeedback(110n, run.run.id, 'USEFUL'),
    ).rejects.toThrow(/does not belong/);
  });

  it('updates subscriptions idempotently and rejects unknown watchers', async () => {
    await configuration.setSubscription(103n, 'stocks', false);
    const repeated = await configuration.setSubscription(103n, 'stocks', false);
    expect(
      repeated.subscriptions.find(({ watcherBot }) => watcherBot === 'stocks'),
    ).toMatchObject({ enabled: false });
    expect(await database.briefingSubscription.count()).toBe(4);
    await expect(
      configuration.setSubscription(103n, 'weather', true),
    ).rejects.toThrow();
  });

  it('stores coordinates only for enabled location modes', async () => {
    const located = await configuration.setLocation(104n, {
      mode: 'LAST_SHARED',
      city: 'Brno',
      country: 'CZ',
      latitude: 49.1951,
      longitude: 16.6068,
    });
    expect(located.location).toMatchObject({
      mode: 'LAST_SHARED',
      city: 'Brno',
      country: 'CZ',
      latitude: 49.1951,
      longitude: 16.6068,
    });
    expect((await configuration.clearLocation(104n)).location).toMatchObject({
      mode: 'DISABLED',
    });
    await expect(
      configuration.setLocation(104n, { mode: 'STATIC', city: 'Brno' }),
    ).rejects.toThrow(/requires latitude and longitude/);
  });

  it('keeps onboarding and settings completion synchronized', async () => {
    expect((await configuration.ensure(105n)).onboarding.currentStep).toBe(
      'LOCATION',
    );
    const progressed = await configuration.setOnboardingStep(105n, 'VOICE');
    expect(progressed.onboarding).toMatchObject({
      completed: false,
      currentStep: 'VOICE',
    });
    const completed = await configuration.setOnboardingStep(105n, 'COMPLETE');
    expect(completed.onboarding.completed).toBe(true);
    expect(completed.settings.onboardingComplete).toBe(true);
  });

  it('claims an idempotent run and finds the latest successful schedule', async () => {
    const input = {
      idempotencyKey: 'scheduled:106:2026-09-06',
      type: 'SCHEDULED',
      scheduledFor: new Date('2026-09-06T05:00:00.000Z'),
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T05:00:00.000Z'),
      subscriptions: ['stocks', 'medical'],
      targetDurationSeconds: 420,
      maximumDurationSeconds: 900,
      voice: 'amy',
    };
    const first = await runs.start(106n, input);
    const duplicate = await runs.start(106n, input);
    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({
      created: false,
      run: { id: first.run.id },
    });
    await runs.complete(first.run.id, {
      status: 'SUCCESS',
      selectedStoryIds: ['story-1'],
      wordCount: 700,
      briefingDataCoverage: 75,
      metrics: { latencyMs: { weather: 42 }, failedDeliveries: 0 },
    });
    expect(await runs.lastSuccessfulScheduled(106n)).toMatchObject({
      id: first.run.id,
      status: 'SUCCESS',
      periodEnd: '2026-09-06T05:00:00.000Z',
      briefingDataCoverage: 75,
      metrics: { latencyMs: { weather: 42 }, failedDeliveries: 0 },
    });
  });

  it('tracks producer degradation, recovery, and fatal failure', async () => {
    await watcherHealth.recordRun({
      watcherBot: 'stocks',
      degraded: true,
      eventsEmitted: 8,
      failedEventPublications: 1,
      sourceFailures: 2,
      runAt: new Date('2026-09-06T04:00:00.000Z'),
    });
    expect(await watcherHealth.list(['stocks', 'medical'])).toMatchObject([
      {
        watcherBot: 'stocks',
        status: 'DEGRADED',
        eventsEmitted: 8,
        failedEventPublications: 1,
        sourceFailures: 2,
      },
    ]);

    await watcherHealth.recordRun({
      watcherBot: 'stocks',
      degraded: false,
      eventsEmitted: 2,
      failedEventPublications: 0,
      sourceFailures: 0,
      runAt: new Date('2026-09-06T05:00:00.000Z'),
    });
    expect(await watcherHealth.list(['stocks'])).toMatchObject([
      { watcherBot: 'stocks', status: 'HEALTHY', eventsEmitted: 2 },
    ]);

    await watcherHealth.recordFailure({
      watcherBot: 'stocks',
      error: 'producer database unavailable',
      runAt: new Date('2026-09-06T06:00:00.000Z'),
    });
    expect(await watcherHealth.list(['stocks'])).toMatchObject([
      {
        watcherBot: 'stocks',
        status: 'UNAVAILABLE',
        lastError: 'producer database unavailable',
      },
    ]);
  });

  it('preserves first mention and refuses stale or cross-chat story updates', async () => {
    const run = await runs.start(107n, {
      idempotencyKey: 'manual:107:first',
      type: 'MANUAL',
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T05:00:00.000Z'),
      subscriptions: ['stocks'],
      targetDurationSeconds: 420,
      maximumDurationSeconds: 900,
    });
    await stories.save(107n, {
      storyId: 'story-1',
      mentionedAt: new Date('2026-09-06T05:00:00.000Z'),
      summary: 'Initial summary',
      importance: 80,
      status: 'NEW',
      lastBriefingRunId: run.run.id,
    });
    const stale = await stories.save(107n, {
      storyId: 'story-1',
      mentionedAt: new Date('2026-09-06T04:00:00.000Z'),
      summary: 'Stale summary',
      importance: 70,
      status: 'UNCHANGED',
    });
    expect(stale).toMatchObject({
      firstMentionedAt: '2026-09-06T05:00:00.000Z',
      lastSummary: 'Initial summary',
    });
    await expect(
      stories.save(108n, {
        storyId: 'story-2',
        mentionedAt: new Date('2026-09-06T06:00:00.000Z'),
        summary: 'Wrong owner',
        importance: 80,
        status: 'NEW',
        lastBriefingRunId: run.run.id,
      }),
    ).rejects.toThrow(/same briefing/);
  });

  it('binds an encrypted Calendar credential to expiring OAuth state', async () => {
    await calendar.beginAuthorization(
      109n,
      'valid-state-hash',
      new Date('2026-09-06T06:10:00.000Z'),
    );
    await expect(
      calendar.completeAuthorization(
        'valid-state-hash',
        'encrypted-refresh-token',
        new Date('2026-09-06T06:00:00.000Z'),
      ),
    ).resolves.toBe(109n);
    expect(await calendar.get(109n)).toMatchObject({
      connected: true,
      encryptedRefreshToken: 'encrypted-refresh-token',
      calendarIds: ['primary'],
    });
    expect((await configuration.ensure(109n)).settings.calendarEnabled).toBe(
      true,
    );

    await calendar.disconnect(109n);
    expect(await calendar.get(109n)).toBeUndefined();
    expect((await configuration.ensure(109n)).settings.calendarEnabled).toBe(
      false,
    );

    await calendar.beginAuthorization(
      109n,
      'expired-state-hash',
      new Date('2026-09-06T05:00:00.000Z'),
    );
    await expect(
      calendar.completeAuthorization(
        'expired-state-hash',
        'encrypted-refresh-token',
        new Date('2026-09-06T06:00:00.000Z'),
      ),
    ).rejects.toThrow(/invalid or expired/);
  });

  it('persists ordered delivery attempts and successful message identity', async () => {
    const run = await runs.start(110n, {
      idempotencyKey: 'manual:110:delivery',
      type: 'MANUAL',
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T05:00:00.000Z'),
      subscriptions: ['stocks'],
      targetDurationSeconds: 420,
      maximumDurationSeconds: 900,
    });
    const failed = await deliveries.start(run.run.id, 'VOICE');
    await deliveries.fail(failed.id, 'temporary Telegram timeout');
    const succeeded = await deliveries.start(run.run.id, 'VOICE');
    await deliveries.succeed(succeeded.id, 'telegram-501');

    expect(succeeded.attempt).toBe(2);
    expect(await deliveries.successful(run.run.id, 'VOICE')).toMatchObject({
      attempt: 2,
      status: 'SUCCESS',
      telegramMessageId: 'telegram-501',
    });
    await expect(deliveries.start(run.run.id, 'EMAIL')).rejects.toThrow();
  });

  it('claims each local scheduled occurrence once and resets after time changes', async () => {
    await configuration.updateSettings(111n, {
      timezone: 'Europe/Prague',
      briefingTime: '07:00',
    });
    await configuration.setOnboardingStep(111n, 'COMPLETE');
    await schedules.initializeMissing(new Date('2026-09-06T04:00:00.000Z'));

    expect(
      await schedules.claimDue(new Date('2026-09-06T05:00:01.000Z')),
    ).toMatchObject([
      {
        telegramChatId: 111n,
        scheduledFor: new Date('2026-09-06T05:00:00.000Z'),
      },
    ]);
    expect(
      await schedules.claimDue(new Date('2026-09-06T05:00:02.000Z')),
    ).toEqual([]);
    expect(
      await database.briefingSettings.findUnique({
        where: { telegramChatId: 111n },
        select: { nextBriefingAt: true },
      }),
    ).toEqual({ nextBriefingAt: new Date('2026-09-07T05:00:00.000Z') });

    await configuration.updateSettings(111n, { briefingTime: '08:00' });
    expect(
      await database.briefingSettings.findUnique({
        where: { telegramChatId: 111n },
        select: { nextBriefingAt: true },
      }),
    ).toEqual({ nextBriefingAt: null });
  });

  it('claims multiple daily and weekly briefing slots from one schedule spec', async () => {
    await configuration.updateSettings(111n, {
      timezone: 'Europe/Prague',
      briefingTime: '07:00;20:00;weekly:MON:07:00;weekly:SUN:20:00',
    });
    await configuration.setOnboardingStep(111n, 'COMPLETE');
    await schedules.initializeMissing(new Date('2026-09-07T04:30:00.000Z'));

    expect(
      await schedules.claimDue(new Date('2026-09-07T05:00:01.000Z')),
    ).toMatchObject([
      {
        telegramChatId: 111n,
        scheduledFor: new Date('2026-09-07T05:00:00.000Z'),
        scheduleKey: 'weekly:MON:07:00',
        periodHours: 168,
      },
    ]);
    expect(
      await database.briefingSettings.findUnique({
        where: { telegramChatId: 111n },
        select: { nextBriefingAt: true },
      }),
    ).toEqual({ nextBriefingAt: new Date('2026-09-07T18:00:00.000Z') });

    expect(
      await schedules.claimDue(new Date('2026-09-07T18:00:01.000Z')),
    ).toMatchObject([
      {
        telegramChatId: 111n,
        scheduledFor: new Date('2026-09-07T18:00:00.000Z'),
        scheduleKey: 'daily:20:00',
      },
    ]);
  });
});
