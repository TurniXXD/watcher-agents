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

export const briefingAbout = `*Personal Morning Briefing*

Personal Morning Briefing is a private, self-hosted Telegram assistant that turns the information collected by your Watcher bots into one prioritized spoken briefing.

*What it does*
• Combines new stock, medical-publication, news, and club events from the watchers you subscribe to.
• Adds optional weather and Google Calendar context for the day ahead.
• Deduplicates related reports, groups them into stories, and preserves continuity with earlier developments.
• Prioritizes urgent and personally relevant items while respecting priority and muted topics.
• Generates an audio briefing with Piper and can optionally send a text transcript.
• Uses feedback on delivered stories to improve later briefings.

*Key advantages*
• Private by design: Telegram is the interface, PostgreSQL stores state, and local services generate the summary and speech.
• Signal over noise: already processed events and repeated coverage are not presented as separate new stories.
• Source-aware: the briefing retains evidence links and reports degraded inputs instead of inventing missing facts.
• Flexible: Calendar is optional, watcher subscriptions are independent, and delivery can follow daily or weekly schedules.

*How to use it*
1. Run \`/start\` to complete the short setup for location, voice, subscriptions, and delivery time.
2. Review or change included watchers with \`/subscriptions\`, \`/subscribe WATCHER\`, and \`/unsubscribe WATCHER\`.
3. Use \`/priority_add TOPIC\` and \`/mute_add TOPIC\` to tune what receives attention.
4. Connect Google Calendar with \`/calendar_connect\` if you want today's events included; this step is optional.
5. Generate an immediate briefing with \`/briefing\`, or a short verification with \`/briefing_test\`.
6. Use \`/settings\` to review the current configuration and \`/help\` for every command.

_Important:_ The briefing summarizes available data and may be incomplete. Review linked primary sources before making medical, financial, or other consequential decisions.`;

export const briefingHelp = [
  '/about — what the briefing bot does and how to use it',
  '/agents — list producers that can be triggered',
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
  '/schedules — show producer schedules and whether they run before the next briefing',
  '/settings — show briefing configuration',
  '/start — start or resume onboarding',
  '/subscribe WATCHER — enable stocks, medical, or news',
  '/subscribe_all — enable all watchers',
  '/subscriptions — show watcher subscriptions',
  '/trigger AGENT [SOURCE] — run a producer now; Brno Events accepts an optional source',
  '/unsubscribe WATCHER — disable stocks, medical, or news',
  '/unsubscribe_all — disable all watchers',
  '/voice — show selected voice',
  '/voice_list — list supported voices',
  '/voice_preview VOICE — preview a voice',
  '/voice_set VOICE — select a voice',
].join('\n');
