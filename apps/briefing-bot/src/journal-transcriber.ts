import { z } from 'zod';

export type JournalTranscriber = {
  transcribe(
    audio: Blob,
    fileName: string,
    signal?: AbortSignal,
  ): Promise<string>;
};

const transcriptionSchema = z.object({ text: z.string().min(1) });

export class OpenAiCompatibleJournalTranscriber implements JournalTranscriber {
  public constructor(
    private readonly options: {
      url: string;
      model: string;
      apiKey?: string;
      fetch?: typeof fetch;
    },
  ) {}

  public async transcribe(
    audio: Blob,
    fileName: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.set('model', this.options.model);
    form.set('language', 'cs');
    form.set('file', audio, fileName);
    const response = await (this.options.fetch ?? fetch)(this.options.url, {
      method: 'POST',
      headers: this.options.apiKey
        ? { Authorization: `Bearer ${this.options.apiKey}` }
        : {},
      body: form,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`Přepis hlasu selhal (${response.status})`);
    }
    return transcriptionSchema.parse(await response.json()).text.trim();
  }
}
