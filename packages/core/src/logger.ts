import pino from 'pino';

export const createLogger = (
  name: string,
  level = process.env.LOG_LEVEL ?? 'info',
) =>
  pino({
    base: { service: name },
    level,
    redact: {
      paths: ['token', '*.token', 'password', '*.password', 'DATABASE_URL'],
      censor: '[REDACTED]',
    },
  });
