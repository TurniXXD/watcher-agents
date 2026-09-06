import pino from 'pino';

export const createLogger = (
  name: string,
  level = process.env.LOG_LEVEL ?? 'info',
) =>
  pino({
    base: { service: name },
    level,
    redact: {
      paths: [
        'token',
        '*.token',
        'apiToken',
        '*.apiToken',
        'authorization',
        '*.authorization',
        'password',
        '*.password',
        'DATABASE_URL',
        'QUIVER_API_TOKEN',
        'clientSecret',
        '*.clientSecret',
        'access_token',
        '*.access_token',
        'refresh_token',
        '*.refresh_token',
        'encryptedRefreshToken',
        '*.encryptedRefreshToken',
        'code',
        '*.code',
        'state',
        '*.state',
      ],
      censor: '[REDACTED]',
    },
  });

export type WatcherLogger = Pick<
  ReturnType<typeof createLogger>,
  'debug' | 'error' | 'info' | 'warn'
>;
