import { z } from 'zod';

const optionalText = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  z.string().optional(),
);

const optionalUrl = optionalText.pipe(z.url().optional());

export const networkingEnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    NETWORKING_TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    NETWORKING_TIMEZONE: z.string().default('Europe/Prague'),
    NETWORKING_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .default(30_000),
    NETWORKING_HEALTH_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(4070),
    GOOGLE_SHEETS_SPREADSHEET_ID: optionalText,
    GOOGLE_SHEETS_NETWORK_RANGE: z
      .string()
      .trim()
      .default("'Contact list'!A:K"),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalText.pipe(z.email().optional()),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: optionalText,
    OLLAMA_URL: optionalUrl,
    OLLAMA_MODEL: optionalText,
    NETWORK_OLLAMA_VISION_MODEL: optionalText,
    OLLAMA_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(180_000)
      .default(120_000),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((value, context) => {
    const sheetCredentials = [
      value.GOOGLE_SHEETS_SPREADSHEET_ID,
      value.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      value.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ];
    const configured = sheetCredentials.filter(Boolean).length;
    if (configured > 0 && configured < sheetCredentials.length) {
      context.addIssue({
        code: 'custom',
        message:
          'GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY must be configured together',
        path: ['GOOGLE_SHEETS_SPREADSHEET_ID'],
      });
    }
    if (Boolean(value.OLLAMA_URL) !== Boolean(value.OLLAMA_MODEL)) {
      context.addIssue({
        code: 'custom',
        message: 'OLLAMA_URL and OLLAMA_MODEL must be configured together',
        path: ['OLLAMA_URL'],
      });
    }
    if (value.NETWORK_OLLAMA_VISION_MODEL && !value.OLLAMA_URL) {
      context.addIssue({
        code: 'custom',
        message: 'NETWORK_OLLAMA_VISION_MODEL requires OLLAMA_URL',
        path: ['NETWORK_OLLAMA_VISION_MODEL'],
      });
    }
  });

export const env = networkingEnvironmentSchema.parse(process.env);
