import { normalizeInstagramUsername } from './normalizer.js';
import type {
  CachedInstagramValue,
  InstagramCache,
  InstagramClient,
  InstagramPost,
  InstagramProfile,
  InstagramProvider,
  InstagramQueryOptions,
} from './types.js';

class MemoryInstagramCache implements InstagramCache {
  readonly #profiles = new Map<
    string,
    CachedInstagramValue<InstagramProfile>
  >();
  readonly #posts = new Map<string, CachedInstagramValue<InstagramPost[]>>();
  public getProfile(username: string) {
    return Promise.resolve(this.#profiles.get(username));
  }
  public setProfile(profile: InstagramProfile, fetchedAt: Date) {
    this.#profiles.set(profile.username, { value: profile, fetchedAt });
    return Promise.resolve();
  }
  public getPosts(username: string) {
    return Promise.resolve(this.#posts.get(username));
  }
  public setPosts(username: string, posts: InstagramPost[], fetchedAt: Date) {
    this.#posts.set(username, { value: posts, fetchedAt });
    return Promise.resolve();
  }
}

export type CachedInstagramClientOptions = {
  cacheTtlMs?: number;
  minimumRequestIntervalMs?: number;
  maximumPostsPerFetch?: number;
  cache?: InstagramCache;
  now?: () => Date;
};

export class CachedInstagramClient implements InstagramClient {
  readonly #cache: InstagramCache;
  readonly #ttl: number;
  readonly #minimumInterval: number;
  readonly #maximumPosts: number;
  readonly #now: () => Date;
  #nextRequestAt = 0;
  #requestTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly provider: InstagramProvider,
    options: CachedInstagramClientOptions = {},
  ) {
    this.#cache = options.cache ?? new MemoryInstagramCache();
    this.#ttl = options.cacheTtlMs ?? 30 * 60_000;
    this.#minimumInterval = options.minimumRequestIntervalMs ?? 5_000;
    this.#maximumPosts = options.maximumPostsPerFetch ?? 20;
    this.#now = options.now ?? (() => new Date());
  }

  private fresh<T>(
    entry: CachedInstagramValue<T> | undefined,
  ): entry is CachedInstagramValue<T> {
    return Boolean(
      entry && this.#now().getTime() - entry.fetchedAt.getTime() < this.#ttl,
    );
  }

  private async rateLimited<T>(task: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.#requestTail;
    this.#requestTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const waitMs = Math.max(0, this.#nextRequestAt - Date.now());
      if (waitMs > 0)
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.#nextRequestAt = Date.now() + this.#minimumInterval;
      return await task();
    } finally {
      release();
    }
  }

  public async getProfile(username: string): Promise<InstagramProfile> {
    const normalized = normalizeInstagramUsername(username);
    const cached = await this.#cache.getProfile(normalized);
    if (this.fresh(cached)) return cached.value;
    const profile = await this.rateLimited(() =>
      this.provider.getProfile(normalized),
    );
    await this.#cache.setProfile(profile, this.#now());
    return profile;
  }

  public async getRecentPosts(
    username: string,
    options: InstagramQueryOptions = {},
  ): Promise<InstagramPost[]> {
    const normalized = normalizeInstagramUsername(username);
    const cached = await this.#cache.getPosts(normalized);
    const limit = Math.min(
      this.#maximumPosts,
      Math.max(1, options.limit ?? this.#maximumPosts),
    );
    const posts = this.fresh(cached)
      ? cached.value
      : await this.rateLimited(async () => {
          const fetched = await this.provider.getRecentPosts(normalized, {
            limit: this.#maximumPosts,
          });
          await this.#cache.setPosts(normalized, fetched, this.#now());
          return fetched;
        });
    return posts
      .filter(
        (post) =>
          !options.since ||
          !post.publishedAt ||
          post.publishedAt >= options.since,
      )
      .slice(0, limit);
  }
}
