import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.url().optional());
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);
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
    SALES_FOLLOWUP_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
      .default('20:00'),
    SALES_TIMEZONE: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA time zone')
      .default('Europe/Prague'),
    QUICKLY_BASE_URL: optionalUrl,
    QUICKLY_API_KEY: z.string().optional(),
    TWENTY_BASE_URL: optionalUrl,
    TWENTY_API_KEY: z.string().optional(),
    TWENTY_APP_FIELDS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    OLLAMA_URL: optionalUrl,
    OLLAMA_MODEL: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || undefined),
    OLLAMA_KEEP_ALIVE: z.string().min(1).default('5m'),
    OLLAMA_NUM_CTX: z.coerce.number().int().min(512).max(131_072).default(4096),
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
    GOOGLE_PLACES_API_KEY: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || undefined),
    GEOAPIFY_API_KEY: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || undefined),
    GOOGLE_SHEETS_SPREADSHEET_ID: optionalString,
    GOOGLE_SHEETS_NETWORK_RANGE: z.string().trim().default('Network!A:H'),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString.pipe(z.email().optional()),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: optionalString,
    NETWORK_OLLAMA_VISION_MODEL: optionalString,
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((value, context) => {
    if (Boolean(value.OLLAMA_URL) !== Boolean(value.OLLAMA_MODEL)) {
      context.addIssue({
        code: 'custom',
        message: 'OLLAMA_URL and OLLAMA_MODEL must be configured together',
        path: ['OLLAMA_URL'],
      });
    }
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
    if (value.NETWORK_OLLAMA_VISION_MODEL && !value.OLLAMA_URL) {
      context.addIssue({
        code: 'custom',
        message: 'NETWORK_OLLAMA_VISION_MODEL requires OLLAMA_URL',
        path: ['NETWORK_OLLAMA_VISION_MODEL'],
      });
    }
  })
  .parse(process.env);
