import { z } from 'zod';

export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    OSINT_TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    OSINT_MAX_COLLECTORS: z.coerce.number().int().min(1).max(24).default(12),
    OSINT_WATCH_POLL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
    OSINT_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4060),
    OLLAMA_URL: z.url().optional().or(z.literal('')),
    OLLAMA_MODEL: z.string().optional(),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);
