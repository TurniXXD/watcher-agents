import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.url().optional());
export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    SALES_TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    SALES_API_TOKEN: z.string().min(32),
    SALES_WEBHOOK_TOKEN: z.string().min(32),
    SALES_PORT: z.coerce.number().int().min(1).max(65535).default(4050),
    SALES_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(30),
    QUICKLY_BASE_URL: optionalUrl,
    QUICKLY_API_KEY: z.string().optional(),
    TWENTY_BASE_URL: optionalUrl,
    TWENTY_API_KEY: z.string().optional(),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);
