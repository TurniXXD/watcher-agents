import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MU_CLUBS_API_TOKEN: z.string().min(16),
  MU_CLUBS_HOST: z.string().default('127.0.0.1'),
  MU_CLUBS_PORT: z.coerce.number().int().min(1).max(65_535).default(4010),
  MU_CLUBS_MONITOR_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(30)
    .max(1_440)
    .default(60),
  MU_CLUBS_SCHEDULER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  INSTAGRAM_CACHE_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(1_440)
    .default(30),
  INSTAGRAM_MIN_REQUEST_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(5_000),
  INSTAGRAM_MAX_POSTS_PER_FETCH: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
