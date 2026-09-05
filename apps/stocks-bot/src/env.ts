import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  STOCKS_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  OLLAMA_URL: z.url(),
  OLLAMA_MODEL: z.string().min(1),
  OLLAMA_KEEP_ALIVE: z.string().min(1).default('5m'),
  OLLAMA_MAX_ITEMS_PER_RUN: z.coerce.number().int().min(0).max(1000).default(0),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(512).max(131_072).default(4096),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().min(64).max(8192).default(768),
  OLLAMA_FULL_ANALYSIS_NUM_PREDICT: z.coerce
    .number()
    .int()
    .min(512)
    .max(8192)
    .default(1536),
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
  STOCK_EVENT_COOLDOWN_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_080)
    .default(360),
  STOCK_TICKER_ANALYSIS_COOLDOWN_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(30),
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
  ALERT_ATTENTION_THRESHOLD: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(85),
  RECONCILIATION_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(60)
    .max(10_080)
    .default(1440),
  VALIDATION_MIN_SAMPLE_SIZE: z.coerce
    .number()
    .int()
    .min(2)
    .max(10_000)
    .default(20),
  ALPHA_VANTAGE_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  ALPHA_VANTAGE_OPTIONS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  QUIVER_API_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  PRICE_ANOMALY_THRESHOLD_PERCENT: z.coerce.number().positive().default(4),
  GAP_ANOMALY_THRESHOLD_PERCENT: z.coerce.number().positive().default(3),
  RELATIVE_VOLUME_ANOMALY_THRESHOLD: z.coerce.number().min(1).default(3),
  VOLATILITY_EXPANSION_THRESHOLD: z.coerce.number().min(1).default(2),
  MARKET_BASELINE_MIN_SNAPSHOTS: z.coerce
    .number()
    .int()
    .min(2)
    .max(20)
    .default(5),
  OPTIONS_VOLUME_OI_ANOMALY_THRESHOLD: z.coerce.number().positive().default(2),
  OPTIONS_VOLUME_BASELINE_MULTIPLIER: z.coerce.number().min(1).default(3),
  OPTIONS_BASELINE_MIN_SNAPSHOTS: z.coerce
    .number()
    .int()
    .min(2)
    .max(20)
    .default(3),
  INSTITUTIONAL_CHANGE_THRESHOLD_PERCENT: z.coerce
    .number()
    .positive()
    .default(5),
  SHORT_INTEREST_CHANGE_THRESHOLD_PERCENT: z.coerce
    .number()
    .positive()
    .default(10),
  SHORT_INTEREST_DAYS_TO_COVER_THRESHOLD: z.coerce
    .number()
    .positive()
    .default(5),
  DISCOVERY_MARKET_DATA_ENTITLEMENT: z
    .enum(['EOD', 'DELAYED', 'REALTIME'])
    .default('EOD'),
  DISCOVERY_SCAN_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(10_080)
    .default(1440),
  DISCOVERY_MOVE_THRESHOLD_PERCENT: z.coerce
    .number()
    .positive()
    .max(1000)
    .default(4),
  DISCOVERY_MIN_PRICE: z.coerce.number().nonnegative().default(2),
  DISCOVERY_MIN_VOLUME: z.coerce.number().int().nonnegative().default(100_000),
  DISCOVERY_MIN_DOLLAR_VOLUME: z.coerce
    .number()
    .nonnegative()
    .default(1_000_000),
  DISCOVERY_MAX_CANDIDATES: z.coerce.number().int().min(1).max(100).default(10),
  DISCOVERY_SUPPORTED_EXCHANGES: z
    .string()
    .default('Nasdaq,NYSE,NYSE American'),
  DISCOVERY_EXCLUDE_OTC: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  DISCOVERY_INVESTIGATION_MINUTES: z.coerce
    .number()
    .int()
    .min(30)
    .max(1440)
    .default(90),
  DISCOVERY_HIGH_RESOLUTION_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(120)
    .default(5),
  DISCOVERY_EVENT_MODE_MINUTES: z.coerce
    .number()
    .int()
    .min(15)
    .max(1440)
    .default(120),
  DISCOVERY_WATCH_DAYS: z.coerce.number().int().min(1).max(365).default(14),
});

export const env = schema.parse(process.env);
