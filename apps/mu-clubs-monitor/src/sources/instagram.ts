import type {
  InstagramClient,
  InstagramPost,
} from '@watcher/sources/instagram';
import type {
  CandidateActivity,
  ClubSourceDefinition,
  MonitorSource,
} from '../types.js';

export class InstagramActivitySource implements MonitorSource {
  public readonly id = 'INSTAGRAM';
  public constructor(private readonly instagram: InstagramClient) {}

  public async fetch(
    source: ClubSourceDefinition,
  ): Promise<CandidateActivity[]> {
    if (!source.username)
      throw new Error('Instagram source is missing its username');
    const posts = await this.instagram.getRecentPosts(source.username, {
      limit: 20,
    });
    return posts.flatMap((post: InstagramPost): CandidateActivity[] => {
      if (!post.caption?.trim()) return [];
      return [
        {
          sourceId: source.id,
          externalItemId: post.shortcode ?? post.id,
          title: post.caption.split(/\r?\n/u)[0]!.slice(0, 500),
          content: post.caption,
          sourceUrl: post.url,
          ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
          raw: post.raw ?? {
            id: post.id,
            shortcode: post.shortcode,
            mediaType: post.mediaType,
          },
        },
      ];
    });
  }
}
