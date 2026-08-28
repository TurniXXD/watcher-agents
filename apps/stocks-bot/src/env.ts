import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  STOCKS_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  OLLAMA_URL: z.url(),
  OLLAMA_MODEL: z.string().min(1),
  OLLAMA_KEEP_ALIVE: z.string().min(1).default('5m'),
  OLLAMA_MAX_ITEMS_PER_RUN: z.coerce.number().int().min(1).max(100).default(5),
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
  SEC_USER_AGENT: z.string().min(5),
  DEFAULT_TIMEZONE: z.string().default('Europe/Prague'),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
