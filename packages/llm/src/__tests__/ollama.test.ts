import type { WatchItem } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaProvider, parseStructuredJson } from '../ollama.js';

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
    expect((await provider.analyze('PUBLICATIONS', item)).status).toBe(
      'FAILED',
    );
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
