import { describe, expect, it, vi } from 'vitest';
import { ReadinessServer, checkOllamaReady } from '../readiness-server.js';

describe('readiness', () => {
  it('checks the lightweight Ollama version endpoint', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({ version: '1.0' });
      },
    );
    await checkOllamaReady('http://ollama/', fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://ollama/api/version');
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not run dependencies before application startup', async () => {
    const probe = vi.fn(async () => undefined);
    const server = new ReadinessServer(probe);

    await expect(server.check()).resolves.toEqual({
      ready: false,
      reason: 'application-starting',
    });
    expect(probe).not.toHaveBeenCalled();

    server.markApplicationReady();
    await expect(server.check()).resolves.toEqual({ ready: true });
    expect(probe).toHaveBeenCalledOnce();
  });
});
