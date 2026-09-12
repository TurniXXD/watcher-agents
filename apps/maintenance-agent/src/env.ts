import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MAINTENANCE_ENABLED: z.stringbool().default(true),
  MAINTENANCE_API_TOKEN: z.string().min(16),
  MAINTENANCE_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  MAINTENANCE_HOST: z.string().default('127.0.0.1'),
  MAINTENANCE_PORT: z.coerce.number().int().min(1).max(65_535).default(4030),
  MAINTENANCE_SCHEDULER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  MAINTENANCE_HEALTH_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(15)
    .max(10_080)
    .default(360),
  MAINTENANCE_ANALYSIS_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(60)
    .max(43_200)
    .default(1440),
  MAINTENANCE_WEEKLY_ANALYSIS_ENABLED: z.stringbool().default(true),
  MAINTENANCE_WEEKLY_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1440)
    .max(43_200)
    .default(10_080),
  MAINTENANCE_JITTER_MAX_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(300),
  MAINTENANCE_SELF_REVIEW_ENABLED: z.stringbool().default(false),
  MAINTENANCE_CHANGELOG_PATH: z
    .string()
    .default('/app/docs/maintenance-changelog.md'),
  MAINTENANCE_RESOURCE_MONITOR_ENABLED: z.stringbool().default(true),
  MAINTENANCE_RESOURCE_MONITOR_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  MAINTENANCE_AGENT_STATUS_STALE_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_080)
    .default(1560),
  MAINTENANCE_AGENT_STATUS_ERROR_LOOKBACK_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_080)
    .default(1440),
  MAINTENANCE_CPU_WARNING_PERCENT: z.coerce
    .number()
    .min(1)
    .max(100)
    .default(90),
  MAINTENANCE_MEMORY_WARNING_PERCENT: z.coerce
    .number()
    .min(1)
    .max(100)
    .default(90),
  MAINTENANCE_GPU_WARNING_PERCENT: z.coerce
    .number()
    .min(1)
    .max(100)
    .default(90),
  MAINTENANCE_CAPACITY_SUSTAINED_SAMPLES: z.coerce
    .number()
    .int()
    .min(1)
    .max(120)
    .default(3),
  MAINTENANCE_CAPACITY_ALERT_COOLDOWN_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_080)
    .default(30),
  MAINTENANCE_NVIDIA_SMI_PATH: z.string().min(1).default('nvidia-smi'),
  OLLAMA_URL: z.url().default('http://host.docker.internal:11434'),
  OLLAMA_CPU_ALERT_PERCENT: z.coerce.number().min(1).max(10_000).default(150),
  OLLAMA_HIGH_USAGE_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(3_600)
    .default(180),
  OLLAMA_CPU_GPU_IMBALANCE_ENABLED: z.stringbool().default(true),
  OLLAMA_CPU_GPU_IMBALANCE_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(3_600)
    .default(120),
  OLLAMA_CPU_GPU_SHARE_MARGIN_PERCENT: z.coerce
    .number()
    .min(1)
    .max(100)
    .default(20),
  OLLAMA_GPU_LOW_UTIL_PERCENT: z.coerce.number().min(0).max(100).default(20),
  OLLAMA_REQUEST_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(3_600)
    .default(300),
  OLLAMA_QUEUE_ALERT_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(10),
  OLLAMA_QUEUE_WAIT_ALERT_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(3_600)
    .default(180),
  OLLAMA_ALERT_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(86_400)
    .default(900),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
