import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MAINTENANCE_ENABLED: z.stringbool().default(true),
  MAINTENANCE_API_TOKEN: z.string().min(16),
  MAINTENANCE_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  MAINTENANCE_HOST: z.string().default('127.0.0.1'),
  MAINTENANCE_PORT: z.coerce.number().int().min(1).max(65_535).default(4030),
  MAINTENANCE_SCHEDULER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  MAINTENANCE_HEALTH_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(15)
    .max(10_080)
    .default(360),
  MAINTENANCE_ANALYSIS_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(60)
    .max(43_200)
    .default(1440),
  MAINTENANCE_WEEKLY_ANALYSIS_ENABLED: z.stringbool().default(true),
  MAINTENANCE_WEEKLY_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1440)
    .max(43_200)
    .default(10_080),
  MAINTENANCE_JITTER_MAX_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(300),
  MAINTENANCE_SELF_REVIEW_ENABLED: z.stringbool().default(false),
  MAINTENANCE_CHANGELOG_PATH: z
    .string()
    .default('/app/docs/maintenance-changelog.md'),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
