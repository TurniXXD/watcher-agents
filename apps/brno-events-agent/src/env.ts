import { z } from 'zod';

const boolean = z.stringbool().default(true);
/** Rendered env files may contain `KEY=''` for unset optional values. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );
const interval = z.coerce.number().int().min(15).max(10_080);
const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BRNO_EVENTS_API_TOKEN: z.string().min(16),
    BRNO_EVENTS_HOST: z.string().default('127.0.0.1'),
    BRNO_EVENTS_PORT: z.coerce.number().int().min(1).max(65_535).default(4020),
    BRNO_EVENTS_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(300_000)
      .default(30_000),
    TZ: z.literal('Europe/Prague').default('Europe/Prague'),
    LOG_LEVEL: z.string().default('info'),
    MEETUP_INTERVAL_MINUTES: interval.default(180),
    GOOUT_INTERVAL_MINUTES: interval.default(360),
    VISITBRNO_INTERVAL_MINUTES: interval.default(360),
    MUNI_INTERVAL_MINUTES: interval.default(360),
    VUT_INTERVAL_MINUTES: interval.default(360),
    JIC_INTERVAL_MINUTES: interval.default(720),
    CEITEC_INTERVAL_MINUTES: interval.default(720),
    VELVET_INNOVATION_INTERVAL_MINUTES: interval.default(360),
    SIDEQUESTY_INTERVAL_MINUTES: interval.default(180),
    OBJEV_BRNO_INTERVAL_MINUTES: interval.default(360),
    IMPACT_HUB_BRNO_INTERVAL_MINUTES: interval.default(180),
    BASE48_CALENDAR_INTERVAL_MINUTES: interval.default(240),
    CSOB_VALIDATION_CAMPS_INTERVAL_MINUTES: interval.default(720),
    MEETUP_ENABLED: boolean,
    GOOUT_ENABLED: boolean,
    VISITBRNO_ENABLED: boolean,
    MUNI_ENABLED: boolean,
    VUT_ENABLED: boolean,
    JIC_ENABLED: boolean,
    CEITEC_ENABLED: boolean,
    VELVET_INNOVATION_ENABLED: boolean,
    SIDEQUESTY_ENABLED: boolean,
    OBJEV_BRNO_ENABLED: boolean,
    IMPACT_HUB_BRNO_ENABLED: boolean,
    BASE48_CALENDAR_ENABLED: boolean,
    CSOB_VALIDATION_CAMPS_ENABLED: boolean,
    MEETUP_URL: z.url().optional(),
    GOOUT_URL: z.url().optional(),
    VISITBRNO_URL: z.url().optional(),
    MUNI_URL: z.url().optional(),
    VUT_URL: z.url().optional(),
    JIC_URL: z.url().optional(),
    CEITEC_URL: z.url().optional(),
    VELVET_INNOVATION_URL: z.url().optional(),
    SIDEQUESTY_URL: z.url().optional(),
    OBJEV_BRNO_URL: z.url().optional(),
    IMPACT_HUB_BRNO_URL: z.url().optional(),
    BASE48_CALENDAR_URL: z.url().optional(),
    CSOB_VALIDATION_CAMPS_URL: z.url().optional(),
    CONTENT_CMS_URL: optional(z.url({ protocol: /^https?$/u })),
    CONTENT_CMS_INGEST_TOKEN: optional(
      z
        .string()
        .regex(
          /^vch_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/u,
          'Expected a vch_ ingestion token',
        ),
    ),
    CONTENT_CMS_SYNC_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(3_600_000)
      .default(60_000),
    CONTENT_CMS_SYNC_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50),
    CONTENT_CMS_SYNC_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),
    CONTENT_CMS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000),
  })
  .refine(
    (value) =>
      Boolean(value.CONTENT_CMS_URL) ===
      Boolean(value.CONTENT_CMS_INGEST_TOKEN),
    {
      message:
        'CONTENT_CMS_URL and CONTENT_CMS_INGEST_TOKEN must be set together',
      path: ['CONTENT_CMS_URL'],
    },
  );
export const env = schema.parse(process.env);
export const sourceSettings = Object.fromEntries(
  [
    'MEETUP',
    'GOOUT',
    'VISITBRNO',
    'MUNI',
    'VUT',
    'JIC',
    'CEITEC',
    'VELVET_INNOVATION',
    'SIDEQUESTY',
    'OBJEV_BRNO',
    'IMPACT_HUB_BRNO',
    'BASE48_CALENDAR',
    'CSOB_VALIDATION_CAMPS',
  ].map((name) => [
    name.toLowerCase().replaceAll('_', '-'),
    {
      interval: env[`${name}_INTERVAL_MINUTES` as keyof typeof env] as number,
      enabled: env[`${name}_ENABLED` as keyof typeof env] as boolean,
      ...(env[`${name}_URL` as keyof typeof env]
        ? { url: env[`${name}_URL` as keyof typeof env] as string }
        : {}),
    },
  ]),
);
