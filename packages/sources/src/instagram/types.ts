export type InstagramExternalLink = { title?: string; url: string };

export type InstagramPost = {
  id: string;
  shortcode?: string;
  account: { username: string; displayName?: string };
  caption?: string;
  publishedAt?: Date;
  url: string;
  mediaType?: 'image' | 'video' | 'carousel' | 'reel' | 'unknown';
  imageUrl?: string;
  raw?: unknown;
};

export type InstagramProfile = {
  username: string;
  displayName?: string;
  biography?: string;
  profileUrl: string;
  externalLinks?: InstagramExternalLink[];
};

export type InstagramQueryOptions = { limit?: number; since?: Date };

export interface InstagramProvider {
  getProfile(username: string): Promise<InstagramProfile>;
  getRecentPosts(
    username: string,
    options?: InstagramQueryOptions,
  ): Promise<InstagramPost[]>;
  getRecentStories?(
    username: string,
    options?: InstagramQueryOptions,
  ): Promise<InstagramPost[]>;
}

export type InstagramClient = InstagramProvider;

export type CachedInstagramValue<T> = { value: T; fetchedAt: Date };

export interface InstagramCache {
  getProfile(
    username: string,
  ): Promise<CachedInstagramValue<InstagramProfile> | undefined>;
  setProfile(profile: InstagramProfile, fetchedAt: Date): Promise<void>;
  getPosts(
    username: string,
  ): Promise<CachedInstagramValue<InstagramPost[]> | undefined>;
  setPosts(
    username: string,
    posts: InstagramPost[],
    fetchedAt: Date,
  ): Promise<void>;
}
