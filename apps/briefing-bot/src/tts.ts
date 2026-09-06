export type TtsLanguage = 'en' | 'cs';

export type TtsSegment = {
  text: string;
  language: TtsLanguage;
};

export type TtsInput = {
  text: string;
  language: TtsLanguage;
  voice: string;
  segments?: readonly TtsSegment[];
};

export type TtsResult = {
  audio: Uint8Array;
  mimeType: 'audio/ogg';
  fileName: string;
  voice: string;
  chunkCount: number;
  generationDurationMs: number;
  audioDurationSeconds: number;
};

export type TtsProvider = {
  generateSpeech(input: TtsInput): Promise<TtsResult>;
};
