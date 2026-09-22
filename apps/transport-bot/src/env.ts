import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.url().optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  TRANSPORT_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  TRANSPORT_REQUEST_FEED_URL: z.url(),
  TRANSPORT_REQUEST_FEED_TOKEN: z.string().optional(),
  TRANSPORT_OSRM_URL: z.url().default('https://router.project-osrm.org'),
  TRANSPORT_DISCOVERY_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(15),
  TRANSPORT_FUEL_BULLETIN_URL: optionalUrl,
  TRANSPORT_CNB_RATE_URL: optionalUrl,
  TRANSPORT_HEALTH_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(4040),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
