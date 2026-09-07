import type { BriefingVoiceId } from '@watcher/database';

export type PiperVoice = {
  id: BriefingVoiceId;
  displayName: string;
  modelId: string;
  sampleRate: number;
};

export const piperVoices = Object.freeze({
  amy: Object.freeze({
    id: 'amy',
    displayName: 'Amy',
    modelId: 'en_US-amy-medium',
    sampleRate: 22_050,
  }),
  hfc_female: Object.freeze({
    id: 'hfc_female',
    displayName: 'HFC Female',
    modelId: 'en_US-hfc_female-medium',
    sampleRate: 22_050,
  }),
  hfc_male: Object.freeze({
    id: 'hfc_male',
    displayName: 'HFC Male',
    modelId: 'en_US-hfc_male-medium',
    sampleRate: 22_050,
  }),
} satisfies Record<BriefingVoiceId, PiperVoice>);

export const czechCalendarVoice = Object.freeze({
  displayName: 'Jirka',
  modelId: 'cs_CZ-jirka-medium',
  sampleRate: 22_050,
});

export const voicePreviewText =
  "Good morning. Here's your morning briefing. We'll start with today's weather and schedule, then move into the most important market, medical, and news developments from the last twenty-four hours.";
