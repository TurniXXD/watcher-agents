import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NEWS_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  OLLAMA_URL: z.url(),
  OLLAMA_MODEL: z.string().min(1),
  OLLAMA_KEEP_ALIVE: z.string().min(1).default('5m'),
  OLLAMA_MAX_ITEMS_PER_RUN: z.coerce.number().int().min(0).max(1000).default(0),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(512).max(131_072).default(4096),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().min(64).max(8192).default(768),
  OLLAMA_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  OLLAMA_THINK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  OLLAMA_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(180_000)
    .default(120_000),
  DEFAULT_TIMEZONE: z.string().default('Europe/Prague'),
  LOG_LEVEL: z.string().default('info'),
  SOURCE_BACKOFF_BASE_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3600)
    .default(60),
  SOURCE_BACKOFF_MAX_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_080)
    .default(360),
});

export const env = schema.parse(process.env);
