import type { WatcherLogger } from '@watcher/core';
import type {
  OllamaRequestCoordinator,
  OllamaRequestPriority,
} from '@watcher/observability';
import { z } from 'zod';

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
  total_duration: z.number().nonnegative().optional(),
});

export type StudyLlm = {
  generate<T>(prompt: string, schema: z.ZodType<T>): Promise<T>;
};

export type OllamaStudyLlmOptions = {
  url: string;
  model: string;
  timeoutMs: number;
  numCtx: number;
  numPredict: number;
  coordinator: OllamaRequestCoordinator;
  logger?: WatcherLogger;
  priority?: OllamaRequestPriority;
  fetch?: typeof fetch;
};

export class OllamaStudyLlm implements StudyLlm {
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: OllamaStudyLlmOptions) {
    this.fetcher = options.fetch ?? fetch;
  }

  public async generate<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    const run = async (coordinatorSignal: AbortSignal) => {
      const response = await this.fetcher(
        `${this.options.url.replace(/\/$/u, '')}/api/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.options.model,
            stream: false,
            format: 'json',
            options: {
              num_ctx: this.options.numCtx,
              num_predict: this.options.numPredict,
            },
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.any([
            coordinatorSignal,
            AbortSignal.timeout(this.options.timeoutMs),
          ]),
        },
      );
      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }
      const parsed = responseSchema.parse(await response.json());
      let value: unknown;
      try {
        value = JSON.parse(parsed.message.content);
      } catch {
        throw new Error('Ollama returned malformed study JSON');
      }
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new Error(
          `Ollama study output failed validation: ${result.error.issues[0]?.message ?? 'invalid output'}`,
        );
      }
      this.options.logger?.info(
        {
          event: 'study_ollama_completed',
          model: this.options.model,
          inputCharacters: prompt.length,
          promptTokens: parsed.prompt_eval_count,
          outputTokens: parsed.eval_count,
          durationNs: parsed.total_duration,
        },
        'Study Ollama request completed',
      );
      return result.data;
    };
    return this.options.coordinator.run(
      {
        caller: 'study-bot',
        model: this.options.model,
        operation: 'chat',
        priority: this.options.priority ?? 'low',
        timeoutMs: this.options.timeoutMs,
        inputSize: prompt.length,
      },
      run,
    );
  }
}
