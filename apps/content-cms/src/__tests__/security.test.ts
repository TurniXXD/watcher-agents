import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkCredential,
  generateCredential,
  hashToken,
  parseBearerToken,
} from '../ingestion/credentials';
import { clientKey, errorResponse, jsonResponse } from '../lib/http';
import { TokenBucketLimiter } from '../lib/rate-limit';
import { loadEnv } from '../env';

describe('bot credentials', () => {
  it('generates parseable tokens and stores only a hash', () => {
    const credential = generateCredential();
    expect(credential.token).toMatch(/^vch_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/u);
    expect(credential.secretHash).toBe(hashToken(credential.token));
    expect(credential.secretHash).not.toContain(credential.token.slice(21));
    expect(parseBearerToken(`Bearer ${credential.token}`)).toEqual({
      keyId: credential.keyId,
      token: credential.token,
    });
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('Bearer vch_short_x')).toBeNull();
  });

  it('checks hash, activity, expiry, and scope', () => {
    const credential = generateCredential();
    const token = parseBearerToken(`Bearer ${credential.token}`)!;
    const record = {
      id: '1',
      botId: 'bot',
      keyId: credential.keyId,
      secretHash: credential.secretHash,
      scopes: ['events'],
      active: true,
    };
    expect(checkCredential(token, record, 'events')).toMatchObject({
      ok: true,
    });
    expect(checkCredential(token, record, 'news')).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      checkCredential(token, { ...record, active: false }, 'events'),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      checkCredential(
        token,
        { ...record, expiresAt: '2000-01-01T00:00:00Z' },
        'events',
      ),
    ).toMatchObject({ reason: 'expired' });
    expect(
      checkCredential(
        token,
        { ...record, secretHash: hashToken('other') },
        'events',
      ),
    ).toMatchObject({ reason: 'invalid_token' });
    expect(checkCredential(token, null, 'events')).toMatchObject({
      status: 401,
    });
  });
});

describe('rate limiting', () => {
  it('refills tokens over time', () => {
    const limiter = new TokenBucketLimiter(2, 60_000);
    expect(limiter.consume('a', 1, 0).allowed).toBe(true);
    expect(limiter.consume('a', 1, 0).allowed).toBe(true);
    const blocked = limiter.consume('a', 1, 0);
    expect(blocked).toMatchObject({ allowed: false });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.consume('a', 1, 30_000).allowed).toBe(true);
    expect(limiter.consume('b', 1, 0).allowed).toBe(true);
  });

  it('uses proxy headers only when trusted', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    });
    expect(clientKey(headers, true)).toBe('203.0.113.9');
    expect(clientKey(headers, false)).toBe('direct');
    expect(
      clientKey(
        new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }),
        true,
      ),
    ).toBe('198.51.100.1');
  });
});

describe('HTTP responses', () => {
  it('adds security and cache headers and answers conditional requests', async () => {
    const response = jsonResponse({ a: 1 }, { cacheSeconds: 300 });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    const etag = response.headers.get('etag')!;
    const conditional = jsonResponse(
      { a: 1 },
      {
        cacheSeconds: 300,
        request: new Request('https://x', {
          headers: { 'if-none-match': etag },
        }),
      },
    );
    expect(conditional.status).toBe(304);
    expect(jsonResponse({ a: 1 }).headers.get('cache-control')).toBe(
      'no-store',
    );
    const error = errorResponse(500, 'internal_error', 'Internal server error');
    expect(await error.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });
});

describe('environment validation', () => {
  const valid = {
    DATABASE_URI: 'postgresql://u:p@h/db',
    PAYLOAD_SECRET: 'x'.repeat(32),
  };
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a minimal development environment', () => {
    expect(loadEnv({ ...valid } as unknown as NodeJS.ProcessEnv)).toMatchObject(
      { SERVER_URL: 'http://localhost:3100', CORS_ORIGINS: [] },
    );
  });

  it('uses the Watcher database for CMS content in production', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://watcher:secret@postgres:5432/watcher',
      PAYLOAD_SECRET: valid.PAYLOAD_SECRET,
      S3_ENDPOINT: 'http://rustfs:9000',
      S3_BUCKET: 'content',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
    } as unknown as NodeJS.ProcessEnv;
    expect(loadEnv(production).DATABASE_URI).toBe(
      'postgresql://watcher:secret@watcher-postgres:5432/watcher',
    );
    expect(
      loadEnv({ ...production, DATABASE_URI: valid.DATABASE_URI }).DATABASE_URI,
    ).toBe('postgresql://watcher:secret@watcher-postgres:5432/watcher');
  });

  it('does not expose malformed Watcher database credentials in errors', () => {
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        DATABASE_URL: 'not-a-url-supersecret',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow('Invalid DATABASE_URL for Content CMS');
  });

  it('rejects partial storage, partial webhook, and production without RustFS, without echoing values', () => {
    expect(() =>
      loadEnv({
        ...valid,
        S3_ENDPOINT: 'http://rustfs:9000',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/S3_ENDPOINT/u);
    expect(() =>
      loadEnv({
        ...valid,
        REVALIDATE_WEBHOOK_URL: 'https://site.example/api/revalidate',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/REVALIDATE_WEBHOOK_URL/u);
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/RustFS/u);
    try {
      loadEnv({
        DATABASE_URI: 'postgresql://user:supersecret@h/db',
        PAYLOAD_SECRET: 'short',
      } as unknown as NodeJS.ProcessEnv);
    } catch (error) {
      expect(String(error)).not.toContain('supersecret');
      expect(String(error)).toContain('PAYLOAD_SECRET');
    }
    expect(
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        S3_ENDPOINT: 'http://rustfs:9000',
        S3_BUCKET: 'content',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 'b',
        CORS_ORIGINS: 'https://vantuch.dev/, https://www.vantuch.dev',
      } as unknown as NodeJS.ProcessEnv).CORS_ORIGINS,
    ).toEqual(['https://vantuch.dev', 'https://www.vantuch.dev']);
  });
});
