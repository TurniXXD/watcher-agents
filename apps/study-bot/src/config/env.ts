import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  STUDY_TELEGRAM_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  OLLAMA_URL: z.url().default('http://172.17.0.1:11434'),
  OLLAMA_MODEL: z.string().min(1).default('qwen3.5:4b'),
  OLLAMA_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  STUDY_OLLAMA_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(600_000)
    .default(300_000),
  STUDY_OLLAMA_NUM_CTX: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(131_072)
    .default(16_384),
  STUDY_OLLAMA_NUM_PREDICT: z.coerce
    .number()
    .int()
    .min(128)
    .max(16_384)
    .default(2_048),
  STUDY_MAX_PDF_SIZE_MB: z.coerce.number().int().min(1).max(100).default(25),
  STUDY_MAX_DOCUMENT_PAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_000)
    .default(500),
  STUDY_S3_ENDPOINT: z.url().default('http://rustfs:9000'),
  STUDY_S3_REGION: z.string().min(1).default('us-east-1'),
  STUDY_S3_DOCUMENTS_BUCKET: z.string().min(3).default('documents'),
  STUDY_S3_MEDIA_BUCKET: z.string().min(3).default('media'),
  STUDY_S3_ACCESS_KEY_ID: z.string().min(1),
  STUDY_S3_SECRET_ACCESS_KEY: z.string().min(1),
  STUDY_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  PIPER_DATA_DIR: z.string().default('/data/piper'),
  STUDY_TTS_PROVIDER: z.literal('piper').default('piper'),
  STUDY_TTS_VOICE: z.string().min(1).default('cs_CZ-jirka-medium'),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
