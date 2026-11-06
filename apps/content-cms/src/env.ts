import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim().replace(/\/$/u, ''))
      .filter(Boolean),
  )
  .pipe(z.array(z.url()));

const bool = (fallback: boolean) => z.stringbool().default(fallback);

const megabytes = (fallback: number) =>
  z.coerce.number().positive().max(2048).default(fallback);

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URI: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    PAYLOAD_SECRET: z.string().min(32),
    SERVER_URL: z.url().default('http://localhost:3100'),
    CORS_ORIGINS: csv,
    CSRF_ORIGINS: csv,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY_HEADERS: bool(false),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: bool(true),
    S3_PREFIX: z.string().default('content-cms'),
    MEDIA_MAX_IMAGE_SIZE_MB: megabytes(15),
    MEDIA_MAX_DOCUMENT_SIZE_MB: megabytes(25),
    MEDIA_MAX_VIDEO_SIZE_MB: megabytes(200),
    PUBLIC_API_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .default(120),
    INGEST_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    INGEST_MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(10_000_000)
      .default(1_000_000),
    INGEST_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    REVALIDATE_WEBHOOK_URL: z.url().optional(),
    REVALIDATE_WEBHOOK_SECRET: z.string().min(32).optional(),
    WEBSITE_PREVIEW_URL: z.url().optional(),
    PREVIEW_SECRET: z.string().min(32).optional(),
    PAYLOAD_JOBS_AUTORUN: bool(true),
    NEXT_PHASE: z.string().optional(),
  })
  .superRefine((value, context) => {
    const s3 = [
      value.S3_ENDPOINT,
      value.S3_BUCKET,
      value.S3_ACCESS_KEY_ID,
      value.S3_SECRET_ACCESS_KEY,
    ];
    if (s3.some(Boolean) && !s3.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together',
        path: ['S3_ENDPOINT'],
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.NEXT_PHASE !== 'phase-production-build' &&
      !s3.every(Boolean)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Production requires RustFS/S3 media storage',
        path: ['S3_ENDPOINT'],
      });
    }
    if (
      Boolean(value.REVALIDATE_WEBHOOK_URL) !==
      Boolean(value.REVALIDATE_WEBHOOK_SECRET)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'REVALIDATE_WEBHOOK_URL and REVALIDATE_WEBHOOK_SECRET must be set together',
        path: ['REVALIDATE_WEBHOOK_URL'],
      });
    }
    if (Boolean(value.WEBSITE_PREVIEW_URL) !== Boolean(value.PREVIEW_SECRET)) {
      context.addIssue({
        code: 'custom',
        message: 'WEBSITE_PREVIEW_URL and PREVIEW_SECRET must be set together',
        path: ['WEBSITE_PREVIEW_URL'],
      });
    }
  });

export type ContentEnv = z.infer<typeof schema>;

let cached: ContentEnv | undefined;

/**
 * `next build` evaluates the Payload config to collect route data but never
 * connects to the database, so placeholders are allowed during that phase only.
 */
const BUILD_PLACEHOLDERS = {
  DATABASE_URI: 'postgresql://build:build@127.0.0.1:5432/build',
  PAYLOAD_SECRET: 'build-only-placeholder-secret-never-used-at-runtime',
};

/** Parses the environment once; issue paths name variables, never values. */
export const loadEnv = (
  source: NodeJS.ProcessEnv = process.env,
): ContentEnv => {
  if (source === process.env && cached) return cached;
  const building = source.NEXT_PHASE === 'phase-production-build';
  const parsed = schema.safeParse(
    building
      ? {
          ...source,
          DATABASE_URI: source.DATABASE_URI || BUILD_PLACEHOLDERS.DATABASE_URI,
          PAYLOAD_SECRET:
            source.PAYLOAD_SECRET || BUILD_PLACEHOLDERS.PAYLOAD_SECRET,
        }
      : source,
  );
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Content CMS environment: ${problems}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
};

export const s3Enabled = (env: ContentEnv): boolean =>
  Boolean(
    env.S3_ENDPOINT &&
    env.S3_BUCKET &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY,
  );
