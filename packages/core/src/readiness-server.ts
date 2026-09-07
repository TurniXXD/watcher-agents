import { createServer, type Server } from 'node:http';
import type { WatcherLogger } from './logger.js';

export type ReadinessProbe = () => Promise<void>;

export const checkOllamaReady = async (
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<void> => {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/api/version`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Ollama readiness HTTP ${response.status}`);
};

export class ReadinessServer {
  private server: Server | undefined;
  private applicationReady = false;

  public constructor(
    private readonly probe: ReadinessProbe,
    private readonly logger?: WatcherLogger,
  ) {}

  public markApplicationReady(): void {
    this.applicationReady = true;
  }

  public markApplicationStopping(): void {
    this.applicationReady = false;
  }

  public async start(port = 8080, host = '0.0.0.0'): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/healthz') {
        response.writeHead(404).end('Not found');
        return;
      }
      void this.check().then(({ ready, reason }) => {
        response.writeHead(ready ? 200 : 503, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(
          JSON.stringify({
            status: ready ? 'ok' : 'unavailable',
            ...(reason ? { reason } : {}),
          }),
        );
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(port, host, resolve);
      });
    } catch (error) {
      this.server = undefined;
      throw error;
    }
    this.logger?.info({ host, port }, 'Readiness server started');
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    this.logger?.info('Readiness server stopped');
  }

  public async check(): Promise<{ ready: boolean; reason?: string }> {
    if (!this.applicationReady) {
      return { ready: false, reason: 'application-starting' };
    }
    try {
      await this.probe();
      return { ready: true };
    } catch (error) {
      this.logger?.warn({ err: error }, 'Readiness probe failed');
      return { ready: false, reason: 'dependency-unavailable' };
    }
  }
}
