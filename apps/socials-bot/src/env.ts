import { z } from 'zod';

const optionalText = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  z.string().optional(),
);

const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean),
);

const commaSeparatedText = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const commaSeparatedLowercase = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

export const socialsEnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    SOCIALS_TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    OLLAMA_URL: z.url().default('http://host.docker.internal:11434'),
    OLLAMA_MODEL: z.string().min(1).default('qwen3.5:4b'),
    SOCIALS_OLLAMA_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    SOCIALS_OLLAMA_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(60_000),
    NOTION_API_KEY: optionalText,
    NOTION_SOCIALS_DATA_SOURCE_ID: optionalText,
    NOTION_API_VERSION: z.string().default('2026-03-11'),
    SOCIALS_TIMEZONE: z.string().default('Europe/Prague'),
    SOCIALS_SUNDAY_REMINDER_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
      .default('09:00'),
    SOCIALS_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .default(30_000),
    SOCIALS_HEALTH_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(4060),
    SOCIALS_TRANSCRIPTION_URL: optionalText,
    SOCIALS_TRANSCRIPTION_API_KEY: optionalText,
    SOCIALS_TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
    SOCIALS_TRENDS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    SOCIALS_TRENDS_SCHEDULE: z.string().default('0 7 * * *'),
    SOCIALS_TRENDS_REPORT_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5),
    SOCIALS_TREND_SOURCES: commaSeparated.default(['YOUTUBE', 'REDDIT']),
    SOCIALS_TREND_HTTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(20_000),
    SOCIALS_YOUTUBE_API_KEY: optionalText,
    SOCIALS_YOUTUBE_MAX_SEARCHES_PER_RUN: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(8),
    SOCIALS_REDDIT_CLIENT_ID: optionalText,
    SOCIALS_REDDIT_CLIENT_SECRET: optionalText,
    SOCIALS_REDDIT_USER_AGENT: optionalText,
    SOCIALS_BLUESKY_API_URL: z.url().default('https://public.api.bsky.app'),
    SOCIALS_BLUESKY_KEYWORDS: commaSeparatedText.default([]),
    SOCIALS_BLUESKY_MAX_POSTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50),
    SOCIALS_BLUESKY_LOOKBACK_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(24 * 7),
    SOCIALS_HACKERNEWS_API_URL: z
      .url()
      .default('https://hacker-news.firebaseio.com/v0'),
    SOCIALS_HACKERNEWS_CATEGORIES: commaSeparatedLowercase
      .pipe(z.array(z.enum(['top', 'new', 'best'])).min(1))
      .default(['top', 'new', 'best']),
    SOCIALS_HACKERNEWS_MAX_STORIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100),
    SOCIALS_MASTODON_INSTANCES: commaSeparatedText
      .pipe(z.array(z.url()).min(1).max(10))
      .default(['https://mastodon.social']),
    SOCIALS_MASTODON_TREND_TYPES: commaSeparatedLowercase
      .pipe(z.array(z.enum(['tags', 'statuses', 'links'])).min(1))
      .default(['tags', 'statuses', 'links']),
    SOCIALS_MASTODON_MAX_ITEMS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50),
    SOCIALS_RSS_FEEDS: commaSeparatedText
      .pipe(z.array(z.url()).max(30))
      .default([]),
    SOCIALS_RSS_MAX_ITEMS_PER_FEED: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error'])
      .default('info'),
  })
  .superRefine((value, context) => {
    if (
      Boolean(value.NOTION_API_KEY) !==
      Boolean(value.NOTION_SOCIALS_DATA_SOURCE_ID)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NOTION_SOCIALS_DATA_SOURCE_ID'],
        message:
          'NOTION_API_KEY and NOTION_SOCIALS_DATA_SOURCE_ID must be configured together.',
      });
    }
    const allowedSources = new Set([
      'GOOGLE_TRENDS',
      'REDDIT',
      'YOUTUBE',
      'TIKTOK',
      'INSTAGRAM',
      'BLUESKY',
      'HACKERNEWS',
      'MASTODON',
      'RSS',
      'MANUAL',
    ]);
    for (const source of value.SOCIALS_TREND_SOURCES) {
      if (!allowedSources.has(source)) {
        context.addIssue({
          code: 'custom',
          path: ['SOCIALS_TREND_SOURCES'],
          message: `Unsupported trend source: ${source}`,
        });
      }
    }
    const redditValues = [
      value.SOCIALS_REDDIT_CLIENT_ID,
      value.SOCIALS_REDDIT_CLIENT_SECRET,
      value.SOCIALS_REDDIT_USER_AGENT,
    ];
    if (redditValues.some(Boolean) && !redditValues.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        path: ['SOCIALS_REDDIT_CLIENT_ID'],
        message:
          'Reddit trend access requires client ID, client secret, and an identifying user agent together.',
      });
    }
  });

export const parseSocialsEnvironment = (input: NodeJS.ProcessEnv) =>
  socialsEnvironmentSchema.parse(input);

export const env = parseSocialsEnvironment(process.env);
