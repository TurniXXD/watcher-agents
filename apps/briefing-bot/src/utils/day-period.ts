export type BriefingDayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

type DayPeriodPresentation = {
  greeting: string;
  label: string;
  icon: string;
  temporalPhrase: string;
  watchHorizon: string;
};

const presentations: Record<BriefingDayPeriod, DayPeriodPresentation> = {
  morning: {
    greeting: 'Good morning',
    label: 'Morning',
    icon: '☀️',
    temporalPhrase: 'this morning',
    watchHorizon: 'today',
  },
  afternoon: {
    greeting: 'Good afternoon',
    label: 'Afternoon',
    icon: '🌤️',
    temporalPhrase: 'this afternoon',
    watchHorizon: 'today',
  },
  evening: {
    greeting: 'Good evening',
    label: 'Evening',
    icon: '🌆',
    temporalPhrase: 'this evening',
    watchHorizon: 'tonight and tomorrow',
  },
  night: {
    greeting: 'Hello',
    label: 'Night',
    icon: '🌙',
    temporalPhrase: 'tonight',
    watchHorizon: 'next',
  },
};

export const briefingDayPeriodFor = (localTime: string): BriefingDayPeriod => {
  const match = /^(\d{2}):\d{2}$/.exec(localTime);
  const hour = Number(match?.[1]);
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid local briefing time: ${localTime}`);
  }
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
};

export const briefingDayPeriodPresentation = (
  dayPeriod: BriefingDayPeriod,
): DayPeriodPresentation => presentations[dayPeriod];
