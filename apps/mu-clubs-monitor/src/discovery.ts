import { discoverSourceLinks } from '@watcher/sources/web';
import type { ClubSourceDefinition } from './types.js';

export const discoverOfficialLinks = (
  html: string,
  discoveryUrl: string,
): ClubSourceDefinition[] => {
  return discoverSourceLinks(html, discoveryUrl, {
    excludeHostnames: ['muni.cz'],
  }).map(({ type, url, username }) => ({
    id: `discovered-${Buffer.from(url).toString('base64url').slice(0, 32)}`,
    type,
    url,
    ...(username ? { username } : {}),
    status: type === 'FACEBOOK' ? 'UNSUPPORTED' : 'ACTIVE',
  }));
};
