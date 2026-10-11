import { describe, expect, it, vi } from 'vitest';
import { OllamaBusinessCardParser } from '../business-card-parser.js';

const card = {
  name: 'Alice Example',
  company: 'Example Components',
  role: 'Sales Manager',
  email: 'alice@example.test',
  phone: '+420 123 456 789',
  website: 'https://example.test',
  linkedin: null,
  location: 'Example 14, Brno',
};

const ollamaResponse = (content: string): Response =>
  Response.json({ message: { content }, done_reason: 'stop' });

describe('OllamaBusinessCardParser', () => {
  it('disables thinking and maps a complete structured response', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return ollamaResponse(JSON.stringify(card));
      },
    );
    const parser = new OllamaBusinessCardParser(
      'http://ollama.test',
      'vision-model',
      5_000,
      fetcher,
    );

    await expect(
      parser.parse(new Uint8Array([1, 2, 3])),
    ).resolves.toMatchObject({
      name: 'Alice Example',
      email: 'alice@example.test',
      web: 'https://example.test',
      active: true,
    });
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected JSON body');
    const request = JSON.parse(body) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: 'vision-model',
      stream: false,
      think: false,
    });
  });

  it('retries an empty model response once', async () => {
    const fetcher = vi
      .fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return ollamaResponse('');
      })
      .mockResolvedValueOnce(ollamaResponse(''))
      .mockResolvedValueOnce(
        ollamaResponse(`\`\`\`json\n${JSON.stringify(card)}\n\`\`\``),
      );
    const parser = new OllamaBusinessCardParser(
      'http://ollama.test',
      'vision-model',
      5_000,
      fetcher,
    );

    await expect(parser.parse(new Uint8Array([1]))).resolves.toMatchObject({
      name: 'Alice Example',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns an actionable error without exposing model output', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return ollamaResponse('');
      },
    );
    const parser = new OllamaBusinessCardParser(
      'http://ollama.test',
      'text-only-model',
      5_000,
      fetcher,
    );

    await expect(parser.parse(new Uint8Array([1]))).rejects.toThrow(
      'did not return a complete business-card JSON after 2 attempts',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
