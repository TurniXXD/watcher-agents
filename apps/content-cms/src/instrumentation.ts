/**
 * Runs once when the Next.js server boots: validates configuration before any
 * request is served and marks the instance unready on SIGTERM/SIGINT. Next.js
 * itself then closes the HTTP server and exits; the database pool closes with
 * the process.
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const log = (
    level: number,
    msg: string,
    extra: Record<string, unknown> = {},
  ) =>
    process.stdout.write(
      `${JSON.stringify({ level, time: Date.now(), service: 'content-cms', msg, ...extra })}\n`,
    );
  const { loadEnv } = await import('./env');
  try {
    loadEnv();
  } catch (error) {
    log(
      60,
      error instanceof Error
        ? error.message
        : 'Invalid Content CMS environment',
    );
    process.exit(1);
  }
  const { registerShutdownSignals } = await import('./system/lifecycle');
  registerShutdownSignals((signal) =>
    log(30, 'Content CMS received shutdown signal', { signal }),
  );
};
