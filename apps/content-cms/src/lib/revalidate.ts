import type { Payload } from 'payload';
import { loadEnv } from '../env';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the website to revalidate cached tags. Fire-and-forget with bounded
 * retries: website availability must never block editorial saves.
 */
export const requestRevalidation = (
  payload: Pick<Payload, 'logger'>,
  tags: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const env = loadEnv();
  if (!env.REVALIDATE_WEBHOOK_URL || !env.REVALIDATE_WEBHOOK_SECRET) {
    return Promise.resolve();
  }
  const url = env.REVALIDATE_WEBHOOK_URL;
  const secret = env.REVALIDATE_WEBHOOK_SECRET;
  const run = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Revalidate-Secret': secret,
          },
          body: JSON.stringify({ tags: [...new Set(tags)] }),
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return;
        if (response.status < 500 && response.status !== 429) {
          payload.logger.warn(
            { status: response.status, tags },
            'Website revalidation rejected',
          );
          return;
        }
      } catch (error) {
        if (attempt === 3) {
          payload.logger.warn(
            {
              err: error instanceof Error ? error.message : String(error),
              tags,
            },
            'Website revalidation failed',
          );
          return;
        }
      }
      await sleep(500 * 2 ** attempt);
    }
    payload.logger.warn({ tags }, 'Website revalidation failed after retries');
  };
  return run();
};
