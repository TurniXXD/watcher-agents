import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REALITY_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  REALITY_DIGIREALITY_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  REALITY_DEFAULT_LOCATIONS: z
    .string()
    .default('Brno,Ostrava,Frýdek-Místek')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1)).min(1).max(20)),
  REALITY_REPORT_SCHEDULE: z.string().default('0 8 1 * *'),
  REALITY_MONITOR_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(1440)
    .default(30),
  REALITY_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4050),
  DEFAULT_TIMEZONE: z.string().default('Europe/Prague'),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
