import { sql } from '@payloadcms/db-postgres';
import type { Payload, PayloadRequest } from 'payload';
import { generateCredential } from '../../ingestion/credentials';

/**
 * Boots Payload against a dedicated test database (created on demand by the
 * Postgres adapter) and applies the committed migrations from scratch.
 */
export const testDatabaseUri = (): string => {
  if (process.env.CONTENT_CMS_TEST_DATABASE_URI)
    return process.env.CONTENT_CMS_TEST_DATABASE_URI;
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base)
    throw new Error(
      'TEST_DATABASE_URL is required for Content CMS integration tests',
    );
  const url = new URL(base);
  url.pathname = '/content_cms_test';
  return url.toString();
};

let instance: Payload | undefined;

export const getTestPayload = async (): Promise<Payload> => {
  if (instance) return instance;
  Object.assign(process.env, {
    DATABASE_URI: testDatabaseUri(),
    PAYLOAD_SECRET: 'test-secret-0123456789abcdef0123456789',
    SERVER_URL: 'https://cms.example.test',
    CORS_ORIGINS: 'https://site.example.test',
    PAYLOAD_JOBS_AUTORUN: 'false',
    LOG_LEVEL: process.env.CMS_TEST_LOG_LEVEL ?? 'silent',
    S3_ENDPOINT: '',
    S3_BUCKET: '',
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: '',
    REVALIDATE_WEBHOOK_URL: '',
    REVALIDATE_WEBHOOK_SECRET: '',
    WEBSITE_PREVIEW_URL: '',
    PREVIEW_SECRET: '',
  });
  for (const key of [
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'REVALIDATE_WEBHOOK_URL',
    'REVALIDATE_WEBHOOK_SECRET',
    'WEBSITE_PREVIEW_URL',
    'PREVIEW_SECRET',
  ]) {
    delete process.env[key];
  }
  const { getPayload } = await import('payload');
  const { default: config } = await import('../../payload.config');
  const { migrations } = await import('../../migrations');
  const payload = await getPayload({ config });
  const db = payload.db as unknown as {
    drizzle: { execute: (query: unknown) => Promise<unknown> };
  };
  await db.drizzle.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.drizzle.execute(sql`CREATE SCHEMA public`);
  await payload.db.migrate({ migrations: migrations as never });
  instance = payload;
  return payload;
};

export const createStaff = async (
  payload: Payload,
  role: 'admin' | 'reviewer' | 'editor',
) => {
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `${role}-${Math.random().toString(36).slice(2)}@example.test`,
      password: 'correct-horse-battery-staple',
      role,
    },
    overrideAccess: true,
  });
  return { ...user, collection: 'users' as const };
};

export const createBotToken = async (
  payload: Payload,
  botId: string,
  scopes: string[],
) => {
  const credential = generateCredential();
  await payload.create({
    collection: 'ingestion-clients',
    data: {
      name: botId,
      botId,
      keyId: credential.keyId,
      secretHash: credential.secretHash,
      scopes: scopes as never,
      active: true,
    },
    overrideAccess: true,
  });
  return credential.token;
};

/** Minimal PayloadRequest for invoking custom endpoint handlers in-process. */
export const endpointRequest = (
  payload: Payload,
  options: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    routeParams?: Record<string, string>;
    user?: unknown;
  },
): PayloadRequest => {
  const text =
    options.body === undefined
      ? ''
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);
  return {
    payload,
    method: options.method ?? 'GET',
    url: options.url,
    headers: new Headers({
      ...(options.body !== undefined
        ? {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(text)),
          }
        : {}),
      ...options.headers,
    }),
    routeParams: options.routeParams ?? {},
    user: options.user ?? null,
    text: () => Promise.resolve(text),
    context: {},
  } as unknown as PayloadRequest;
};

export const findEndpoint = async (path: string, method = 'get') => {
  const { default: config } = await import('../../payload.config');
  const resolved = await config;
  const endpoint = (resolved.endpoints || []).find(
    (candidate) => candidate.path === path && candidate.method === method,
  );
  if (!endpoint) throw new Error(`Endpoint ${method} ${path} not found`);
  return endpoint.handler;
};
