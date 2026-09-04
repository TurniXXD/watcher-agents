import type { WatchItem } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../ollama.js';

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
  it('parses and validates structured responses', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
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
    expect((await provider.analyze('PUBLICATIONS', item)).status).toBe(
      'SUCCESS',
    );
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
  });
});
