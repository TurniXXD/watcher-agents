import { z } from 'zod';

const transcriptionSchema = z.object({ text: z.string().trim().min(1) });

export type SocialTranscriber = {
  transcribe(audio: Uint8Array, filename: string): Promise<string>;
};

export class HttpSocialTranscriber implements SocialTranscriber {
  public constructor(
    private readonly options: {
      url: string;
      apiKey?: string;
      model: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  public async transcribe(
    audio: Uint8Array,
    filename: string,
  ): Promise<string> {
    const form = new FormData();
    form.set('model', this.options.model);
    form.set(
      'file',
      new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }),
      filename,
    );
    const response = await (this.options.fetch ?? fetch)(this.options.url, {
      method: 'POST',
      ...(this.options.apiKey
        ? { headers: { Authorization: `Bearer ${this.options.apiKey}` } }
        : {}),
      body: form,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
    });
    if (!response.ok) {
      throw new Error(`Transcription returned HTTP ${response.status}`);
    }
    return transcriptionSchema.parse(await response.json()).text;
  }
}
