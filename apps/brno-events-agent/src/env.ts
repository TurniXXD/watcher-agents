import { z } from 'zod';

const boolean = z.stringbool().default(true);
const interval = z.coerce.number().int().min(15).max(10_080);
const schema = z.object({
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
  MEETUP_ENABLED: boolean,
  GOOUT_ENABLED: boolean,
  VISITBRNO_ENABLED: boolean,
  MUNI_ENABLED: boolean,
  VUT_ENABLED: boolean,
  JIC_ENABLED: boolean,
  CEITEC_ENABLED: boolean,
  MEETUP_URL: z.url().optional(),
  GOOUT_URL: z.url().optional(),
  VISITBRNO_URL: z.url().optional(),
  MUNI_URL: z.url().optional(),
  VUT_URL: z.url().optional(),
  JIC_URL: z.url().optional(),
  CEITEC_URL: z.url().optional(),
});
export const env = schema.parse(process.env);
export const sourceSettings = Object.fromEntries(
  ['MEETUP', 'GOOUT', 'VISITBRNO', 'MUNI', 'VUT', 'JIC', 'CEITEC'].map(
    (name) => [
      name.toLowerCase(),
      {
        interval: env[`${name}_INTERVAL_MINUTES` as keyof typeof env] as number,
        enabled: env[`${name}_ENABLED` as keyof typeof env] as boolean,
        ...(env[`${name}_URL` as keyof typeof env]
          ? { url: env[`${name}_URL` as keyof typeof env] as string }
          : {}),
      },
    ],
  ),
);
