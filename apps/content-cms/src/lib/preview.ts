import { createHmac } from 'node:crypto';
import { loadEnv } from '../env';

/**
 * Website draft-preview link. The website verifies the HMAC with the shared
 * PREVIEW_SECRET; the secret itself never leaves the CMS.
 */
export const websitePreviewUrl = (
  path: string | null,
  now = Date.now(),
): string | null => {
  const env = loadEnv();
  if (!path || !env.WEBSITE_PREVIEW_URL || !env.PREVIEW_SECRET) return null;
  const expires = Math.floor(now / 1000) + 3600;
  const signature = createHmac('sha256', env.PREVIEW_SECRET)
    .update(`${path}\n${expires}`)
    .digest('base64url');
  const url = new URL(env.WEBSITE_PREVIEW_URL);
  url.searchParams.set('path', path);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
};
