import type {
  BriefingConfiguration,
  BriefingOnboardingStepId,
} from '@watcher/database';
import { defaultBriefingScheduleSpec } from '@watcher/database';

const steps: BriefingOnboardingStepId[] = [
  'LOCATION',
  'VOICE',
  'SUBSCRIPTIONS',
  'BRIEFING_TIME',
  'COMPLETE',
];

export const nextOnboardingStep = (
  current: BriefingOnboardingStepId,
): BriefingOnboardingStepId => {
  // Keep accepting the persisted legacy step, but do not make Calendar part
  // of the required onboarding sequence.
  if (current === 'GOOGLE_CALENDAR') return 'SUBSCRIPTIONS';
  return (
    steps[Math.min(steps.indexOf(current) + 1, steps.length - 1)] ?? 'COMPLETE'
  );
};

export const renderConfiguration = (
  configuration: BriefingConfiguration,
): string => {
  const { settings, location, subscriptions, onboarding } = configuration;
  const enabled = subscriptions
    .filter((subscription) => subscription.enabled)
    .map((subscription) => subscription.watcherBot)
    .join(', ');
  const place =
    location?.mode === 'DISABLED' || !location
      ? 'disabled'
      : [location.city, location.country].filter(Boolean).join(', ') ||
        `${location.latitude}, ${location.longitude}`;
  return [
    'Morning briefing settings',
    '',
    `Setup: ${onboarding.completed ? 'complete' : `step ${onboarding.currentStep}`}`,
    `Location: ${place}`,
    `Voice: ${settings.voice}`,
    `Calendar: ${settings.calendarEnabled ? 'enabled' : 'not connected'}`,
    `Subscriptions: ${enabled || 'none'}`,
    `Delivery schedule: ${settings.briefingTime} (${settings.timezone})`,
    `Duration: target ${settings.targetDurationMinutes} min, max ${settings.maximumDurationMinutes} min`,
    `Transcript: ${settings.sendTranscript ? 'on' : 'off'}`,
    `Priority topics: ${settings.priorityKeywords.join(', ') || 'none'}`,
    `Muted topics: ${settings.mutedKeywords.join(', ') || 'none'}`,
  ].join('\n');
};

export const briefingHelp = [
  '/briefing — generate a briefing now',
  '/briefing_duration MINUTES — set target length',
  '/briefing_max_duration MINUTES — set hard maximum length',
  '/briefing_settings — show briefing configuration',
  '/briefing_test — generate a short test briefing',
  '/briefing_time HH:mm[;HH:mm|weekly:DAY:HH:mm] — set delivery schedule',
  `/briefing_time default — morning + 20:00, with 7-day briefings on Monday morning and Sunday evening (${defaultBriefingScheduleSpec})`,
  '/briefing_transcript on|off — configure text transcript',
  '/calendar_connect — connect Google Calendar',
  '/calendar_disconnect — disconnect Google Calendar',
  '/calendar_refresh — refresh Calendar status',
  '/calendar_status — show Calendar status',
  '/help — show commands',
  '/location — show saved location',
  '/location_clear — disable location',
  '/location_set — location setup instructions',
  '/location_status — show saved location',
  '/mute_add TOPIC — reduce non-urgent coverage of a topic',
  '/mute_remove TOPIC — remove a muted topic',
  '/priority_add TOPIC — boost a topic, company, ticker, or subject',
  '/priority_remove TOPIC — remove a priority topic',
  '/settings — show briefing configuration',
  '/start — start or resume onboarding',
  '/subscribe WATCHER — enable stocks, medical, or news',
  '/subscribe_all — enable all watchers',
  '/subscriptions — show watcher subscriptions',
  '/unsubscribe WATCHER — disable stocks, medical, or news',
  '/unsubscribe_all — disable all watchers',
  '/voice — show selected voice',
  '/voice_list — list supported voices',
  '/voice_preview VOICE — preview a voice',
  '/voice_set VOICE — select a voice',
].join('\n');
