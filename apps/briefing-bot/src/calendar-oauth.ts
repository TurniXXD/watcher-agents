import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import type { CalendarIntegrationStore } from '@watcher/database';
import { z } from 'zod';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

type Fetch = typeof fetch;
type CalendarTokenStore = Pick<
  CalendarIntegrationStore,
  'beginAuthorization' | 'completeAuthorization' | 'get' | 'markRefreshed'
>;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class CalendarCredentialCipher {
  private readonly key: Buffer;

  public constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.byteLength !== 32) {
      throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY must be 32 base64 bytes');
    }
  }

  public encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  public decrypt(payload: string): string {
    const [version, encodedIv, encodedTag, encodedCiphertext] =
      payload.split('.');
    if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error('Unsupported encrypted Calendar credential');
    }
    const iv = Buffer.from(encodedIv, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}

const stateHash = (state: string): string =>
  createHash('sha256').update(state).digest('hex');

const responseJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`Google OAuth request failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
};

export class GoogleCalendarOAuth {
  public constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly store: CalendarTokenStore,
    private readonly cipher: CalendarCredentialCipher,
    private readonly fetcher: Fetch = fetch,
  ) {}

  public async authorizationUrl(telegramChatId: bigint): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    await this.store.beginAuthorization(
      telegramChatId,
      stateHash(state),
      new Date(Date.now() + 10 * 60_000),
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/calendar.readonly',
    );
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return url.toString();
  }

  public async completeCallback(code: string, state: string): Promise<bigint> {
    if (!code || !state) throw new Error('Missing Google OAuth code or state');
    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });
    const tokens = tokenResponseSchema.parse(
      await responseJson(
        await this.fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        }),
      ),
    );
    if (!tokens.refresh_token) {
      throw new Error('Google did not return an offline refresh token');
    }
    return this.store.completeAuthorization(
      stateHash(state),
      this.cipher.encrypt(tokens.refresh_token),
    );
  }

  public async accessToken(telegramChatId: bigint): Promise<string> {
    const integration = await this.store.get(telegramChatId);
    if (!integration?.encryptedRefreshToken) {
      throw new Error('Google Calendar is not connected');
    }
    const body = new URLSearchParams({
      refresh_token: this.cipher.decrypt(integration.encryptedRefreshToken),
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
    });
    const tokens = tokenResponseSchema.parse(
      await responseJson(
        await this.fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        }),
      ),
    );
    await this.store.markRefreshed(telegramChatId);
    return tokens.access_token;
  }
}
