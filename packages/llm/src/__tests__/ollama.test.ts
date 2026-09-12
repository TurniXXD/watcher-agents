import type { WatchItem } from '@watcher/core';
import type {
  OllamaRequestContext,
  OllamaRequestCoordinator,
} from '@watcher/observability';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  OllamaEmbeddingProvider,
  OllamaProvider,
  parseStructuredJson,
} from '../ollama.js';

const item: WatchItem = {
  id: 'PUBMED:1',
  source: 'PUBMED',
  externalId: '1',
  title: 'Paper',
  url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
  content: 'Abstract',
  metadata: {},
};

describe('OllamaProvider', () => {
  it('queues each chat attempt with its caller, priority, model, and timeout', async () => {
    const contexts: OllamaRequestContext[] = [];
    const coordinator: OllamaRequestCoordinator = {
      run: async <T>(context: OllamaRequestContext, task: () => Promise<T>) => {
        contexts.push(context);
        return task();
      },
      snapshot: vi.fn(),
    };
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'qwen3',
      caller: 'briefing-bot',
      priority: 'high',
      timeoutMs: 45_000,
      coordinator,
      fetch: vi.fn(async () =>
        Response.json({ message: { content: '{"ok":true}' } }),
      ),
    });

    await provider.generateStructured(
      'hello',
      { type: 'object' },
      z.object({ ok: z.boolean() }),
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      caller: 'briefing-bot',
      model: 'qwen3',
      operation: 'chat',
      priority: 'high',
      timeoutMs: 45_000,
    });
  });

  it('extracts JSON from Markdown fences and leading commentary', () => {
    expect(parseStructuredJson('```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    });
    expect(
      parseStructuredJson('Based on the source, the result is:\n{"ok":true}'),
    ).toEqual({ ok: true });
  });

  it('parses and validates structured responses', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            prompt_eval_count: 123,
            eval_count: 45,
            total_duration: 1_500_000_000,
            message: {
              content: JSON.stringify({
                title: 'Paper',
                summary: 'Summary',
                importance: 7,
                relevance: 9,
                keyFindings: ['Finding'],
                methods: [],
                limitations: [],
                whyInteresting: 'Relevant',
                confidence: 0.8,
              }),
            },
          }),
          { status: 200 },
        );
      },
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });
    expect(await provider.analyze('PUBLICATIONS', item)).toMatchObject({
      status: 'SUCCESS',
      metrics: {
        durationMs: 1500,
        llmCallCount: 1,
        promptTokens: 123,
        completionTokens: 45,
        estimatedCostUsd: 0,
      },
    });
    const requestBody = mockFetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    const body = JSON.parse(requestBody) as {
      keep_alive: string;
      think: boolean;
      messages: Array<{ content: string }>;
      options: { num_ctx: number; num_predict: number };
    };
    expect(body).toMatchObject({
      keep_alive: '5m',
      think: false,
      options: { num_ctx: 4096, num_predict: 768 },
    });
    expect(body.messages[0]?.content).not.toContain(
      'routine Form 3, Form 4, Form 5, and Form 144',
    );
  });

  it('adds stock-specific guidance to avoid overrating routine ownership filings', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                title: 'Ownership filing',
                summary: 'A routine Form 4 was submitted.',
                importance: 3,
                sentiment: 'neutral',
                eventType: 'Form 4',
                positives: [],
                negatives: [],
                risks: [],
                catalysts: [],
                confidence: 0.8,
              }),
            },
          }),
          { status: 200 },
        );
      },
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });
    expect((await provider.analyze('STOCKS', item)).status).toBe('SUCCESS');
    const requestBody = mockFetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    const body = JSON.parse(requestBody) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0]?.content).toContain(
      'Treat routine Form 3, Form 4, Form 5, and Form 144 ownership filings as low-to-moderate importance',
    );
    expect(body.messages[0]?.content).toContain(
      'Do not infer insider trading, legal violations, regulatory penalties, or market manipulation',
    );
  });

  it('uses the news schema and profile topics for news analysis', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({
          message: {
            content: JSON.stringify({
              title: 'Energy policy update',
              summary: 'The government changed its energy policy.',
              importance: 8,
              relevance: 9,
              category: 'POLITICS',
              keyFacts: ['Policy changed'],
              whyItMatters: 'It affects energy investment.',
              entities: ['Czech government'],
              confidence: 0.8,
            }),
          },
        });
      },
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });
    const outcome = await provider.analyze('NEWS', {
      ...item,
      metadata: { scope: 'CZECH', topics: ['energy'] },
    });

    expect(outcome).toMatchObject({
      status: 'SUCCESS',
      result: { category: 'POLITICS', relevance: 9 },
    });
    const requestBody = mockFetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') throw new Error('Expected body');
    expect(requestBody).toContain('Configured topics');
    expect(requestBody).toContain('energy');
    expect(requestBody).toContain(
      'importance and relevance must be whole integers from 1 through 10',
    );
  });

  it('normalizes repairable news schema deviations', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            analysis: {
              headline: 'Energy policy update',
              overview: 'The government changed its energy policy.',
              importance_score: '80%',
              relevanceScore: 90,
              category: 'politics',
              facts: [{ fact: 'Policy changed' }],
              impact: 'It affects energy investment.',
              entities: [{ name: 'Czech government' }],
              confidence_score: 85,
            },
          }),
        },
      }),
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });

    await expect(provider.analyze('NEWS', item)).resolves.toMatchObject({
      status: 'SUCCESS',
      result: {
        title: 'Energy policy update',
        summary: 'The government changed its energy policy.',
        importance: 8,
        relevance: 9,
        category: 'POLITICS',
        keyFacts: ['Policy changed'],
        whyItMatters: 'It affects energy investment.',
        entities: ['Czech government'],
        confidence: 0.85,
      },
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('fills omitted news details from conservative defaults', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            title: 'Short report',
            summary: 'Only the basic facts were available.',
            importance: 4,
            relevance: 3,
            category: 'other',
          }),
        },
      }),
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });

    await expect(provider.analyze('NEWS', item)).resolves.toMatchObject({
      status: 'SUCCESS',
      result: {
        keyFacts: [],
        whyItMatters: 'Only the basic facts were available.',
        entities: [],
        confidence: 0.35,
      },
    });
  });

  it('retries transient fetch failures and includes their root cause', async () => {
    const socketError = Object.assign(new Error('socket closed'), {
      code: 'UND_ERR_SOCKET',
    });
    const fetchError = new TypeError('fetch failed', { cause: socketError });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce(
        Response.json({ message: { content: '{"ok":true}' } }),
      );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      retries: 1,
      fetch: mockFetch,
    });

    await expect(
      provider.generateStructured(
        'Return an object.',
        { type: 'object' },
        z.object({ ok: z.boolean() }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const failingProvider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      retries: 0,
      fetch: vi.fn(async () => Promise.reject(fetchError)),
    });
    await expect(failingProvider.analyze('NEWS', item)).resolves.toMatchObject({
      status: 'FAILED',
      error: 'fetch failed — socket closed — UND_ERR_SOCKET',
    });
  });

  it('retries invalid output then records failure', async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: '{}' } }), {
          status: 200,
        }),
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      retries: 1,
      fetch: mockFetch,
    });
    expect((await provider.analyze('STOCKS', item)).status).toBe('FAILED');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondCall = mockFetch.mock.calls[1] as unknown as
      [RequestInfo | URL, RequestInit?] | undefined;
    const secondRequestBody = secondCall?.[1]?.body;
    expect(typeof secondRequestBody).toBe('string');
    if (typeof secondRequestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    expect(
      (
        JSON.parse(secondRequestBody) as {
          options: { num_predict: number };
        }
      ).options.num_predict,
    ).toBe(1_536);
  });

  it('normalizes repairable publication schema deviations', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            title: 'Paper',
            abstract: 'Normalized summary',
            importance: 10.7,
            relevance: '8.6',
            findings: 'One finding',
            methods: null,
            significance: 'Useful result',
            confidence: 1.2,
          }),
        },
      }),
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });

    const outcome = await provider.analyze('PUBLICATIONS', item);

    expect(outcome).toMatchObject({
      status: 'SUCCESS',
      result: {
        title: 'Paper',
        summary: 'Normalized summary',
        importance: 10,
        relevance: 9,
        keyFindings: ['One finding'],
        methods: [],
        limitations: [],
        whyInteresting: 'Useful result',
        confidence: 1,
      },
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('normalizes null publication significance and missing confidence conservatively', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            title: 'Cold atmospheric plasma-treated bioink',
            summary:
              'The paper describes a biocompatible RONS delivery bioink.',
            importance: 6,
            relevance: 7,
            keyFindings: ['The platform delivers RONS in 3D bioprinting.'],
            methods: [],
            limitations: [],
            whyInteresting: null,
          }),
        },
      }),
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: mockFetch,
    });

    const outcome = await provider.analyze('PUBLICATIONS', item);

    expect(outcome).toMatchObject({
      status: 'SUCCESS',
      result: {
        whyInteresting:
          'The paper describes a biocompatible RONS delivery bioink.',
        confidence: 0.35,
      },
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('records a persistent incomplete publication response after a bounded repair retry', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            title: { text: 'Wrong shape' },
            importance: null,
            relevance: null,
            confidence: null,
          }),
        },
      }),
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      retries: 1,
      fetch: mockFetch,
    });

    const outcome = await provider.analyze('PUBLICATIONS', item);

    expect(outcome).toMatchObject({ status: 'FAILED' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondCall = mockFetch.mock.calls[1] as unknown as
      [RequestInfo | URL, RequestInit?] | undefined;
    const secondRequestBody = secondCall?.[1]?.body;
    expect(typeof secondRequestBody).toBe('string');
    if (typeof secondRequestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    expect(secondRequestBody).toContain(
      'Every required property must be present and non-null',
    );
  });

  it('repairs a truncated response with a larger output budget', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          done_reason: 'length',
          eval_count: 512,
          message: { content: '{"ok":' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ message: { content: '{"ok":true}' } }),
      );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      numPredict: 512,
      retries: 1,
      fetch: mockFetch,
    });

    const generated = await provider.generateStructuredWithMetrics(
      'Return an object.',
      { type: 'object' },
      z.object({ ok: z.boolean() }),
    );

    expect(generated.result).toEqual({ ok: true });
    expect(generated.metrics.llmCallCount).toBe(2);
    const secondCall = mockFetch.mock.calls[1] as unknown as
      [RequestInfo | URL, RequestInit?] | undefined;
    const secondRequestBody = secondCall?.[1]?.body;
    expect(typeof secondRequestBody).toBe('string');
    if (typeof secondRequestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    const secondBody = JSON.parse(secondRequestBody) as {
      messages: Array<{ role: string; content: string }>;
      options: { num_predict: number };
    };
    expect(secondBody.options.num_predict).toBe(1_024);
    expect(secondBody.messages).toHaveLength(3);
    expect(secondBody.messages[2]?.content).toContain(
      'previous JSON response was truncated',
    );
    expect(secondBody.messages[2]?.content).toContain('Output only JSON');
  });

  it('treats token-limited valid but incomplete JSON as truncated', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          done_reason: 'length',
          eval_count: 256,
          message: { content: '{"title":"Partial"}' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          message: {
            content: '{"title":"Complete","summary":"Finished"}',
          },
        }),
      );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      numPredict: 256,
      retries: 1,
      fetch: mockFetch,
    });

    await expect(
      provider.generateStructured(
        'Return an object.',
        { type: 'object' },
        z.object({ title: z.string(), summary: z.string() }),
      ),
    ).resolves.toEqual({ title: 'Complete', summary: 'Finished' });

    const secondCall = mockFetch.mock.calls[1] as unknown as
      [RequestInfo | URL, RequestInit?] | undefined;
    const secondRequestBody = secondCall?.[1]?.body;
    expect(typeof secondRequestBody).toBe('string');
    if (typeof secondRequestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    const secondBody = JSON.parse(secondRequestBody) as {
      messages: Array<{ content: string }>;
      options: { num_predict: number };
    };
    expect(secondBody.options.num_predict).toBe(512);
    expect(secondBody.messages[2]?.content).toContain(
      'previous JSON response was truncated',
    );
  });

  it('includes bounded Ollama response details in failures', async () => {
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'missing',
      retries: 0,
      fetch: vi.fn(async () =>
        Response.json(
          { error: `model not found ${'x'.repeat(600)}` },
          { status: 404 },
        ),
      ),
    });

    const outcome = await provider.analyze('PUBLICATIONS', item);

    expect(outcome).toMatchObject({
      status: 'FAILED',
    });
    if (outcome.status !== 'FAILED') throw new Error('Expected failure');
    expect(outcome.error).toContain(
      'Ollama returned HTTP 404: {"error":"model not found',
    );
    expect(outcome.error.length).toBeLessThanOrEqual(526);
  });

  it('allows full analysis to request a larger output budget', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            message: { content: JSON.stringify({ ok: true }) },
          }),
          { status: 200 },
        );
      },
    );
    const provider = new OllamaProvider({
      url: 'http://ollama',
      model: 'test',
      numPredict: 768,
      fetch: mockFetch,
    });

    await provider.generateStructured(
      'prompt',
      { type: 'object' },
      z.object({ ok: z.boolean() }),
      undefined,
      { numPredict: 1536 },
    );

    const requestBody = mockFetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') {
      throw new Error('Expected Ollama request body to be a string');
    }
    const body = JSON.parse(requestBody) as {
      options: { num_predict: number };
    };
    expect(body.options.num_predict).toBe(1536);
  });
});

describe('OllamaEmbeddingProvider', () => {
  it('queues embedding requests through the same coordinator', async () => {
    const contexts: OllamaRequestContext[] = [];
    const coordinator: OllamaRequestCoordinator = {
      run: async <T>(context: OllamaRequestContext, task: () => Promise<T>) => {
        contexts.push(context);
        return task();
      },
      snapshot: vi.fn(),
    };
    const provider = new OllamaEmbeddingProvider({
      url: 'http://ollama',
      model: 'nomic-embed-text',
      caller: 'stocks-bot',
      priority: 'normal',
      timeoutMs: 30_000,
      coordinator,
      fetch: vi.fn(async () => Response.json({ embeddings: [[0.1]] })),
    });

    await provider.embed(['abc']);

    expect(contexts[0]).toMatchObject({
      caller: 'stocks-bot',
      model: 'nomic-embed-text',
      operation: 'embedding',
      priority: 'normal',
      timeoutMs: 30_000,
      inputSize: 3,
    });
  });

  it('requests one embedding for every input and preserves their order', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        });
      },
    );
    const provider = new OllamaEmbeddingProvider({
      url: 'http://ollama/',
      model: 'nomic-embed-text',
      fetch: mockFetch,
    });

    await expect(provider.embed(['first', 'second'])).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]?.[0]).toBe('http://ollama/api/embed');
    const requestBody = mockFetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') {
      throw new Error('Expected Ollama embedding request body to be a string');
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      model: 'nomic-embed-text',
      input: ['first', 'second'],
      truncate: true,
    });
  });

  it('rejects incomplete or inconsistent embedding responses', async () => {
    const provider = new OllamaEmbeddingProvider({
      url: 'http://ollama',
      model: 'test',
      fetch: vi.fn(async () => Response.json({ embeddings: [[0.1, 0.2]] })),
    });
    await expect(provider.embed(['first', 'second'])).rejects.toThrow(
      /1 embeddings for 2 inputs/,
    );
  });
});
