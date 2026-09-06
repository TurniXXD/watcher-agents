import { createServer, type Server } from 'node:http';
import type { WatcherLogger } from '@watcher/core';
import type { GoogleCalendarOAuth } from './calendar-oauth.js';

export const oauthCallbackPathFromRedirectUri = (
  redirectUri: string,
): string => {
  const url = new URL(redirectUri);
  if (url.search || url.hash) {
    throw new Error(
      'Google Calendar redirect URI must not contain query or hash',
    );
  }
  if (url.pathname === '/') {
    throw new Error(
      'Google Calendar redirect URI must contain a callback path',
    );
  }
  return url.pathname;
};

export class OAuthCallbackServer {
  private server: Server | undefined;
  private readonly callbackPath: string;

  public constructor(
    private readonly oauth: GoogleCalendarOAuth,
    private readonly onConnected: (telegramChatId: bigint) => Promise<void>,
    redirectUri: string,
    private readonly logger: WatcherLogger,
  ) {
    this.callbackPath = oauthCallbackPathFromRedirectUri(redirectUri);
  }

  public async start(port: number, host: string): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => {
      void this.handle(request.url, request.method)
        .then((result) => {
          response.writeHead(result.status, {
            'content-type': 'text/plain; charset=utf-8',
          });
          response.end(result.body);
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, 'Calendar OAuth callback failed');
          response.writeHead(400, {
            'content-type': 'text/plain; charset=utf-8',
          });
          response.end(
            'Calendar connection failed. Return to Telegram and try again.',
          );
        });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, resolve);
    });
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(
    requestUrl: string | undefined,
    method: string | undefined,
  ): Promise<{ status: number; body: string }> {
    if (method !== 'GET' || !requestUrl) {
      return { status: 404, body: 'Not found' };
    }
    const url = new URL(requestUrl, 'http://localhost');
    if (url.pathname !== this.callbackPath) {
      return { status: 404, body: 'Not found' };
    }
    const oauthError = url.searchParams.get('error');
    if (oauthError) throw new Error(`Google OAuth denied: ${oauthError}`);
    const chatId = await this.oauth.completeCallback(
      url.searchParams.get('code') ?? '',
      url.searchParams.get('state') ?? '',
    );
    await this.onConnected(chatId);
    return {
      status: 200,
      body: 'Google Calendar connected. You can close this page and return to Telegram.',
    };
  }
}
