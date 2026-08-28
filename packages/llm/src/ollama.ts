import {
  publicationAnalysisSchema,
  stockAnalysisSchema,
  type AnalysisOutcome,
  type Analyzer,
  type WatcherKind,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
});

const stockJsonSchema = {
  type: 'object',
  required: [
    'title',
    'summary',
    'importance',
    'sentiment',
    'eventType',
    'positives',
    'negatives',
    'risks',
    'catalysts',
    'confidence',
  ],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    importance: { type: 'integer', minimum: 1, maximum: 10 },
    sentiment: { enum: ['positive', 'neutral', 'negative'] },
    eventType: { type: 'string' },
    positives: { type: 'array', items: { type: 'string' } },
    negatives: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    catalysts: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

const publicationJsonSchema = {
  type: 'object',
  required: [
    'title',
    'summary',
    'importance',
    'relevance',
    'keyFindings',
    'methods',
    'limitations',
    'whyInteresting',
    'confidence',
  ],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    importance: { type: 'integer', minimum: 1, maximum: 10 },
    relevance: { type: 'integer', minimum: 1, maximum: 10 },
    keyFindings: { type: 'array', items: { type: 'string' } },
    methods: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
    whyInteresting: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

const promptFor = (
  kind: WatcherKind,
  item: WatchItem,
): string => `You analyze source material for a private ${kind.toLowerCase()} watcher.
Use only facts present in the source. Clearly qualify inference. Never invent missing data.
Return only JSON matching the supplied schema.

Title: ${item.title}
Source: ${item.source}
Published: ${item.publishedAt?.toISOString() ?? 'unknown'}
Metadata: ${JSON.stringify(item.metadata)}
Content:
${item.content.slice(0, 24_000)}`;

export type OllamaOptions = {
  url: string;
  model: string;
  retries?: number;
  timeoutMs?: number;
  keepAlive?: string;
  numCtx?: number;
  numPredict?: number;
  think?: boolean;
  fetch?: typeof fetch;
};

export class OllamaProvider implements Analyzer {
  readonly #fetch: typeof fetch;
  readonly #retries: number;
  readonly #timeoutMs: number;

  public constructor(private readonly options: OllamaOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#retries = options.retries ?? 1;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  public async analyze(
    kind: WatcherKind,
    item: WatchItem,
    signal?: AbortSignal,
  ): Promise<AnalysisOutcome> {
    let lastError = 'Unknown Ollama error';

    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#fetch(
          `${this.options.url.replace(/\/$/, '')}/api/chat`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: this.options.model,
              stream: false,
              keep_alive: this.options.keepAlive ?? '5m',
              think: this.options.think ?? false,
              format:
                kind === 'STOCKS' ? stockJsonSchema : publicationJsonSchema,
              messages: [{ role: 'user', content: promptFor(kind, item) }],
              options: {
                temperature: 0.1,
                num_ctx: this.options.numCtx ?? 4096,
                num_predict: this.options.numPredict ?? 768,
              },
            }),
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
              : AbortSignal.timeout(this.#timeoutMs),
          },
        );

        if (!response.ok)
          throw new Error(`Ollama returned HTTP ${response.status}`);
        const payload = responseSchema.parse(await response.json());
        const json: unknown = JSON.parse(payload.message.content);
        const result =
          kind === 'STOCKS'
            ? stockAnalysisSchema.parse(json)
            : publicationAnalysisSchema.parse(json);
        return { status: 'SUCCESS', result };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return { status: 'FAILED', error: lastError };
  }
}
