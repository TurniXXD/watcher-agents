let shuttingDown = false;

export const isShuttingDown = (): boolean => shuttingDown;

/**
 * Marks the instance unready on SIGTERM/SIGINT so the healthcheck and proxy
 * stop routing new work while Next.js drains in-flight requests and exits.
 */
export const registerShutdownSignals = (
  onSignal: (signal: string) => void = () => undefined,
): void => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      shuttingDown = true;
      onSignal(signal);
    });
  }
};
