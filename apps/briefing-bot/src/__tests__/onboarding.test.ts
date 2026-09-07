import type { BriefingConfiguration } from '@watcher/database';
import { describe, expect, it } from 'vitest';
import {
  briefingAbout,
  briefingHelp,
  nextOnboardingStep,
  renderConfiguration,
} from '../onboarding.js';

const configuration: BriefingConfiguration = {
  settings: {
    id: 'settings-1',
    telegramChatId: '123',
    onboardingComplete: false,
    language: 'en',
    voice: 'amy',
    timezone: 'Europe/Prague',
    briefingTime: '07:00',
    targetDurationMinutes: 7,
    maximumDurationMinutes: 15,
    sendTranscript: false,
    calendarEnabled: false,
    weatherEnabled: true,
    priorityKeywords: [],
    mutedKeywords: [],
    createdAt: '2026-09-06T05:00:00.000Z',
    updatedAt: '2026-09-06T05:00:00.000Z',
  },
  subscriptions: [
    {
      id: 'subscription-1',
      watcherBot: 'stocks',
      enabled: true,
      createdAt: '2026-09-06T05:00:00.000Z',
      updatedAt: '2026-09-06T05:00:00.000Z',
    },
    {
      id: 'subscription-2',
      watcherBot: 'medical',
      enabled: false,
      createdAt: '2026-09-06T05:00:00.000Z',
      updatedAt: '2026-09-06T05:00:00.000Z',
    },
  ],
  location: {
    id: 'location-1',
    mode: 'LAST_SHARED',
    city: 'Brno',
    country: 'CZ',
    latitude: 49.1951,
    longitude: 16.6068,
    updatedAt: '2026-09-06T05:00:00.000Z',
  },
  onboarding: {
    completed: false,
    currentStep: 'VOICE',
    updatedAt: '2026-09-06T05:00:00.000Z',
  },
};

describe('briefing onboarding copy and transitions', () => {
  it('advances through every persisted onboarding step', () => {
    expect(nextOnboardingStep('LOCATION')).toBe('VOICE');
    expect(nextOnboardingStep('VOICE')).toBe('SUBSCRIPTIONS');
    expect(nextOnboardingStep('GOOGLE_CALENDAR')).toBe('SUBSCRIPTIONS');
    expect(nextOnboardingStep('SUBSCRIPTIONS')).toBe('BRIEFING_TIME');
    expect(nextOnboardingStep('BRIEFING_TIME')).toBe('COMPLETE');
    expect(nextOnboardingStep('COMPLETE')).toBe('COMPLETE');
  });

  it('renders persisted settings without implying disabled integrations work', () => {
    const rendered = renderConfiguration(configuration);
    expect(rendered).toContain('Setup: step VOICE');
    expect(rendered).toContain('Location: Brno, CZ');
    expect(rendered).toContain('Calendar: not connected');
    expect(rendered).toContain('Subscriptions: stocks');
  });

  it('keeps the documented command list alphabetical', () => {
    const commands = briefingHelp
      .split('\n')
      .map((line) => line.split(' ')[0] ?? '');
    expect(commands).toEqual([...commands].sort());
    expect(commands.every((command) => !command.includes('-'))).toBe(true);
  });

  it('documents the briefing purpose and primary workflow', () => {
    expect(briefingAbout).toContain('*What it does*');
    expect(briefingAbout).toContain('*Key advantages*');
    expect(briefingAbout).toContain('*How to use it*');
    expect(briefingAbout).toContain('`/briefing`');
    expect(briefingAbout).toContain('Google Calendar');
    expect(briefingAbout.length).toBeLessThanOrEqual(4096);
  });
});
