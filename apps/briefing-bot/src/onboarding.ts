import type {
  BriefingConfiguration,
  BriefingOnboardingStepId,
} from '@watcher/database';

const steps: BriefingOnboardingStepId[] = [
  'LOCATION',
  'VOICE',
  'GOOGLE_CALENDAR',
  'SUBSCRIPTIONS',
  'BRIEFING_TIME',
  'COMPLETE',
];

export const nextOnboardingStep = (
  current: BriefingOnboardingStepId,
): BriefingOnboardingStepId =>
  steps[Math.min(steps.indexOf(current) + 1, steps.length - 1)] ?? 'COMPLETE';

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
    `Delivery: ${settings.briefingTime} (${settings.timezone})`,
    `Duration: target ${settings.targetDurationMinutes} min, max ${settings.maximumDurationMinutes} min`,
    `Transcript: ${settings.sendTranscript ? 'on' : 'off'}`,
  ].join('\n');
};

export const briefingHelp = [
  '/briefing — generate a briefing now',
  '/briefing-duration MINUTES — set target length',
  '/briefing-max-duration MINUTES — set hard maximum length',
  '/briefing-settings — show briefing configuration',
  '/briefing-test — generate a short test briefing',
  '/briefing-time HH:mm — set local delivery time',
  '/briefing-transcript on|off — configure text transcript',
  '/calendar-connect — connect Google Calendar',
  '/calendar-disconnect — disconnect Google Calendar',
  '/calendar-refresh — refresh Calendar status',
  '/calendar-status — show Calendar status',
  '/help — show commands',
  '/location — show saved location',
  '/location-clear — disable location',
  '/location-set — location setup instructions',
  '/location-status — show saved location',
  '/settings — show briefing configuration',
  '/start — start or resume onboarding',
  '/subscribe WATCHER — enable stocks or medical',
  '/subscribe-all — enable all watchers',
  '/subscriptions — show watcher subscriptions',
  '/unsubscribe WATCHER — disable stocks or medical',
  '/unsubscribe-all — disable all watchers',
  '/voice — show selected voice',
  '/voice-list — list supported voices',
  '/voice-preview VOICE — preview a voice',
  '/voice-set VOICE — select a voice',
].join('\n');
