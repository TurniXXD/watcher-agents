import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BRIEFING_TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    OLLAMA_URL: z.url(),
    OLLAMA_MODEL: z.string().min(1),
    BRIEFING_EMBEDDING_MODEL: optionalString,
    BRIEFING_EMBEDDING_MIN_SIMILARITY: z.coerce
      .number()
      .min(0.5)
      .max(1)
      .default(0.82),
    BRIEFING_EMBEDDING_WINDOW_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(96),
    OLLAMA_KEEP_ALIVE: z.string().min(1).default('5m'),
    OLLAMA_NUM_CTX: z.coerce.number().int().min(512).max(131_072).default(8192),
    OLLAMA_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
    OLLAMA_THINK: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    OLLAMA_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(600_000)
      .default(300_000),
    DEFAULT_TIMEZONE: z.string().default('Europe/Prague'),
    LOG_LEVEL: z.string().default('info'),
    GOOGLE_CALENDAR_CLIENT_ID: optionalString,
    GOOGLE_CALENDAR_CLIENT_SECRET: optionalString,
    GOOGLE_CALENDAR_REDIRECT_URI: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().optional(),
    ),
    CALENDAR_TOKEN_ENCRYPTION_KEY: optionalString,
    CALENDAR_OAUTH_LISTEN_HOST: z.string().default('0.0.0.0'),
    CALENDAR_OAUTH_LISTEN_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(8_789),
    PIPER_DATA_DIR: z.string().default('/data/piper'),
    PIPER_PYTHON_PATH: z.string().default('python3'),
    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),
    PIPER_KEEP_TEMP: z.enum(['true', 'false']).default('false'),
    BRIEFING_TTS_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(2),
    BRIEFING_TELEGRAM_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3),
    BRIEFING_TELEGRAM_RETRY_BASE_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(1000),
    BRIEFING_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(300_000)
      .default(30_000),
    BRIEFING_FRESHNESS_MAX_AGE_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_440)
      .default(180),
    BRIEFING_FRESHNESS_WAIT_TIMEOUT_MINUTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(120)
      .default(20),
    BRIEFING_FRESHNESS_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(30_000),
  })
  .superRefine((value, context) => {
    const calendarValues = [
      value.GOOGLE_CALENDAR_CLIENT_ID,
      value.GOOGLE_CALENDAR_CLIENT_SECRET,
      value.GOOGLE_CALENDAR_REDIRECT_URI,
      value.CALENDAR_TOKEN_ENCRYPTION_KEY,
    ];
    const configured = calendarValues.filter(Boolean).length;
    if (configured !== 0 && configured !== calendarValues.length) {
      context.addIssue({
        code: 'custom',
        message: 'Google Calendar OAuth variables must be configured together',
      });
    }
  });

export const env = schema.parse(process.env);
