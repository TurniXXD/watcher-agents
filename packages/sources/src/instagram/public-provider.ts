import {
  InstagramPrivateProfileError,
  InstagramUnavailableError,
} from './errors.js';
import {
  deduplicateInstagramPosts,
  instagramProfileUrl,
  normalizeInstagramUsername,
} from './normalizer.js';
import { parseInstagramHtml } from './parser.js';
import type {
  InstagramPost,
  InstagramProfile,
  InstagramProvider,
  InstagramQueryOptions,
} from './types.js';

export class InstagramPublicProvider implements InstagramProvider {
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async load(username: string) {
    const normalized = normalizeInstagramUsername(username);
    const response = await this.fetcher(instagramProfileUrl(normalized), {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Watcher/1.0 (+public-profile-monitor)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new InstagramUnavailableError(
        `Instagram returned HTTP ${response.status} for @${normalized}`,
      );
    }
    const parsed = parseInstagramHtml(normalized, await response.text());
    if (parsed.private) {
      throw new InstagramPrivateProfileError(
        `Instagram profile @${normalized} is private`,
      );
    }
    return parsed;
  }

  public async getProfile(username: string): Promise<InstagramProfile> {
    return (await this.load(username)).profile;
  }

  public async getRecentPosts(
    username: string,
    options: InstagramQueryOptions = {},
  ): Promise<InstagramPost[]> {
    const posts = deduplicateInstagramPosts((await this.load(username)).posts)
      .filter(
        (post) =>
          !options.since ||
          !post.publishedAt ||
          post.publishedAt >= options.since,
      )
      .sort(
        (left, right) =>
          (right.publishedAt?.getTime() ?? 0) -
          (left.publishedAt?.getTime() ?? 0),
      );
    return posts.slice(0, options.limit ?? 20);
  }
}
