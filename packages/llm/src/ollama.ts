import {
  errorMessage,
  publicationAnalysisSchema,
  stockAnalysisSchema,
  type AnalysisOutcome,
  type AnalysisMetrics,
  type Analyzer,
  type WatcherKind,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
  total_duration: z.number().nonnegative().optional(),
  done_reason: z.string().optional(),
});

class TruncatedStructuredOutputError extends Error {
  public override readonly name = 'TruncatedStructuredOutputError';
}

const completeJsonEnd = (value: string, start: number): number | undefined => {
  const opening = value[start];
  if (opening !== '{' && opening !== '[') return undefined;
  const expectedClosings = [opening === '{' ? '}' : ']'];
  let quoted = false;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') expectedClosings.push('}');
    else if (character === '[') expectedClosings.push(']');
    else if (character === '}' || character === ']') {
      if (expectedClosings.at(-1) !== character) return undefined;
      expectedClosings.pop();
      if (expectedClosings.length === 0) return index + 1;
    }
  }
  return undefined;
};

export const parseStructuredJson = (content: string): unknown => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1];
  const candidates = fenced ? [trimmed, fenced.trim()] : [trimmed];
  let directError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      directError ??= error;
    }
  }

  let incompleteJson = false;
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{' && trimmed[start] !== '[') continue;
    const end = completeJsonEnd(trimmed, start);
    if (end === undefined) {
      incompleteJson = true;
      continue;
    }
    try {
      return JSON.parse(trimmed.slice(start, end)) as unknown;
    } catch {
      // Continue to another JSON-looking section in the response.
    }
  }
  if (incompleteJson) {
    throw new TruncatedStructuredOutputError(
      'Ollama structured response ended before its JSON was complete',
    );
  }
  throw directError instanceof Error
    ? directError
    : new Error('Ollama returned no JSON object');
};

const correctivePrompt = (reason: string, truncated: boolean): string =>
  `${truncated ? 'Your previous JSON response was truncated.' : 'Your previous response did not match the required JSON schema.'}
Return the complete corrected JSON object now. Output only JSON: no Markdown fences, commentary, or reasoning.
Validation failure: ${reason.slice(0, 1_000)}`;

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

const stockGuidance = `For stock watcher output:
- Treat routine Form 3, Form 4, Form 5, and Form 144 ownership filings as low-to-moderate importance unless the source states an unusual transaction size, control change, legal issue, restatement, investigation, bankruptcy, or other material event.
- Do not infer insider trading, legal violations, regulatory penalties, or market manipulation from ordinary insider sale or proposed-sale filings.
- Put compliance or insider-trading risks in "risks" only when the source explicitly says there is an investigation, allegation, enforcement action, violation, or unusual undisclosed conflict.
- Use importance 8-10 only for clearly material company events such as earnings shocks, guidance changes, major financing, M&A, executive leadership changes, clinical/regulatory decisions, material contracts, delisting, litigation, insolvency, or similarly high-impact filings.`;

const promptFor = (
  kind: WatcherKind,
  item: WatchItem,
): string => `You analyze source material for a private ${kind.toLowerCase()} watcher.
Use only facts present in the source. Clearly qualify inference. Never invent missing data.
Return only JSON matching the supplied schema.
${kind === 'STOCKS' ? `\n${stockGuidance}` : ''}

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

export type StructuredJsonSchema = Readonly<Record<string, unknown>>;
export type StructuredGeneration<T> = {
  result: T;
  metrics: AnalysisMetrics;
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
    try {
      if (kind === 'STOCKS') {
        const generated = await this.generateStructuredWithMetrics(
          promptFor(kind, item),
          stockJsonSchema,
          stockAnalysisSchema,
          signal,
        );
        return {
          status: 'SUCCESS',
          result: generated.result,
          metrics: generated.metrics,
        };
      }
      const generated = await this.generateStructuredWithMetrics(
        promptFor(kind, item),
        publicationJsonSchema,
        publicationAnalysisSchema,
        signal,
      );
      return {
        status: 'SUCCESS',
        result: generated.result,
        metrics: generated.metrics,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        error: errorMessage(error),
      };
    }
  }

  public async generateStructured<T>(
    prompt: string,
    format: StructuredJsonSchema,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    generation: { numPredict?: number } = {},
  ): Promise<T> {
    return (
      await this.generateStructuredWithMetrics(
        prompt,
        format,
        schema,
        signal,
        generation,
      )
    ).result;
  }

  public async generateStructuredWithMetrics<T>(
    prompt: string,
    format: StructuredJsonSchema,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    generation: { numPredict?: number } = {},
  ): Promise<StructuredGeneration<T>> {
    let lastError = 'Unknown Ollama error';
    let invalidContent: string | undefined;
    let invalidReason: string | undefined;
    let previousWasTruncated = false;
    const configuredNumPredict =
      generation.numPredict ?? this.options.numPredict ?? 768;

    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const numPredict = Math.min(configuredNumPredict * 2 ** attempt, 8_192);
        const messages = [
          { role: 'user', content: prompt },
          ...(invalidContent && invalidReason
            ? [
                {
                  role: 'assistant',
                  content: invalidContent.slice(0, 6_000),
                },
                {
                  role: 'user',
                  content: correctivePrompt(
                    invalidReason,
                    previousWasTruncated,
                  ),
                },
              ]
            : []),
        ];
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
              format,
              messages,
              options: {
                temperature: 0.1,
                num_ctx: this.options.numCtx ?? 4096,
                num_predict: numPredict,
              },
            }),
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
              : AbortSignal.timeout(this.#timeoutMs),
          },
        );

        if (!response.ok) {
          const detail = (await response.text())
            .replaceAll(/\s+/g, ' ')
            .trim()
            .slice(0, 500);
          throw new Error(
            `Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
          );
        }
        const payload = responseSchema.parse(await response.json());
        invalidContent = payload.message.content;
        const reachedTokenLimit =
          payload.done_reason === 'length' ||
          (payload.eval_count !== undefined &&
            payload.eval_count >= numPredict);
        let json: unknown;
        try {
          json = parseStructuredJson(payload.message.content);
        } catch (error) {
          const truncated =
            error instanceof TruncatedStructuredOutputError ||
            reachedTokenLimit;
          previousWasTruncated = truncated;
          invalidReason = truncated
            ? `output reached its ${numPredict}-token limit before completing JSON`
            : errorMessage(error);
          throw new Error(invalidReason, { cause: error });
        }
        let result: T;
        try {
          result = schema.parse(json);
        } catch (error) {
          previousWasTruncated = reachedTokenLimit;
          invalidReason = reachedTokenLimit
            ? `output reached its ${numPredict}-token limit before completing the required JSON fields: ${errorMessage(error)}`
            : errorMessage(error);
          throw error;
        }
        return {
          result,
          metrics: {
            ...(payload.total_duration === undefined
              ? {}
              : {
                  durationMs: Math.round(payload.total_duration / 1_000_000),
                }),
            llmCallCount: attempt + 1,
            ...(payload.prompt_eval_count === undefined
              ? {}
              : { promptTokens: payload.prompt_eval_count }),
            ...(payload.eval_count === undefined
              ? {}
              : { completionTokens: payload.eval_count }),
            estimatedCostUsd: 0,
          },
        };
      } catch (error) {
        lastError = errorMessage(error);
      }
    }

    throw new Error(lastError);
  }
}
