import {
  MuClubActivityType,
  MuClubSourceStatus,
  MuClubSourceType,
  MuMonitorRunStatus,
  RunTrigger,
  type DatabaseClient,
  type Prisma,
} from '@watcher/database';
import {
  instagramProfileUrl,
  type InstagramCache,
  type InstagramPost,
  type InstagramProfile,
} from '@watcher/sources/instagram';
import type {
  ClassifiedActivity,
  ClubDefinition,
  ClubSourceDefinition,
} from './types.js';
import { activityContentHash } from './classifier.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

const sourceType = (value: ClubSourceDefinition['type']): MuClubSourceType =>
  MuClubSourceType[value];
const sourceStatus = (
  value: ClubSourceDefinition['status'],
): MuClubSourceStatus => MuClubSourceStatus[value];

export class PostgresInstagramCache implements InstagramCache {
  public constructor(private readonly db: DatabaseClient) {}

  public async getProfile(username: string) {
    const row = await this.db.instagramAccount.findUnique({
      where: { username },
    });
    if (!row) return undefined;
    const externalLinks = Array.isArray(row.externalLinks)
      ? (row.externalLinks as Array<{ title?: string; url: string }>)
      : [];
    return {
      fetchedAt: row.fetchedAt,
      value: {
        username: row.username,
        ...(row.displayName ? { displayName: row.displayName } : {}),
        ...(row.biography ? { biography: row.biography } : {}),
        profileUrl: row.profileUrl,
        ...(externalLinks.length ? { externalLinks } : {}),
      },
    };
  }

  public async setProfile(
    profile: InstagramProfile,
    fetchedAt: Date,
  ): Promise<void> {
    await this.db.instagramAccount.upsert({
      where: { username: profile.username },
      create: {
        username: profile.username,
        displayName: profile.displayName ?? null,
        biography: profile.biography ?? null,
        profileUrl: profile.profileUrl,
        externalLinks: json(profile.externalLinks ?? []),
        fetchedAt,
      },
      update: {
        displayName: profile.displayName ?? null,
        biography: profile.biography ?? null,
        profileUrl: profile.profileUrl,
        externalLinks: json(profile.externalLinks ?? []),
        fetchedAt,
      },
    });
  }

  public async getPosts(username: string) {
    const rows = await this.db.instagramPost.findMany({
      where: { username },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    if (!rows[0]) return undefined;
    return {
      fetchedAt: rows.reduce(
        (latest, row) => (row.fetchedAt > latest ? row.fetchedAt : latest),
        rows[0].fetchedAt,
      ),
      value: rows.map((row): InstagramPost => ({
        id: row.id,
        ...(row.shortcode ? { shortcode: row.shortcode } : {}),
        account: { username },
        ...(row.caption ? { caption: row.caption } : {}),
        ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
        url: row.url,
        mediaType: (['image', 'video', 'carousel', 'reel', 'unknown'].includes(
          row.mediaType ?? '',
        )
          ? row.mediaType
          : 'unknown') as NonNullable<InstagramPost['mediaType']>,
        ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
        ...(row.raw === null ? {} : { raw: row.raw }),
      })),
    };
  }

  public async setPosts(
    username: string,
    posts: InstagramPost[],
    fetchedAt: Date,
  ): Promise<void> {
    await this.db.instagramAccount.upsert({
      where: { username },
      create: {
        username,
        profileUrl: instagramProfileUrl(username),
        externalLinks: [],
        fetchedAt,
      },
      update: { fetchedAt },
    });
    await this.db.$transaction(
      posts.map((post) =>
        this.db.instagramPost.upsert({
          where: { id: post.id },
          create: {
            id: post.id,
            username,
            shortcode: post.shortcode ?? null,
            caption: post.caption ?? null,
            publishedAt: post.publishedAt ?? null,
            url: post.url,
            mediaType: post.mediaType ?? null,
            imageUrl: post.imageUrl ?? null,
            contentHash: activityContentHash(username, {
              sourceId: username,
              externalItemId: post.shortcode ?? post.id,
              title: post.caption?.split(/\r?\n/u)[0] ?? post.id,
              content: post.caption ?? '',
              sourceUrl: post.url,
            }),
            ...(post.raw === undefined ? {} : { raw: json(post.raw) }),
            fetchedAt,
          },
          update: {
            shortcode: post.shortcode ?? null,
            caption: post.caption ?? null,
            publishedAt: post.publishedAt ?? null,
            url: post.url,
            mediaType: post.mediaType ?? null,
            imageUrl: post.imageUrl ?? null,
            ...(post.raw === undefined ? {} : { raw: json(post.raw) }),
            fetchedAt,
          },
        }),
      ),
    );
  }
}

export class MuClubsStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async seedRegistry(clubs: readonly ClubDefinition[]): Promise<void> {
    for (const club of clubs) {
      await this.db.muClub.upsert({
        where: { id: club.id },
        create: {
          id: club.id,
          slug: club.slug,
          name: club.name,
          status: sourceStatus(club.status),
          discoveryUrl: club.discoveryUrl ?? null,
        },
        update: {
          slug: club.slug,
          name: club.name,
          status: sourceStatus(club.status),
          discoveryUrl: club.discoveryUrl ?? null,
        },
      });
      for (const source of club.sources) {
        await this.db.muClubSource.upsert({
          where: { id: source.id },
          create: {
            id: source.id,
            clubId: club.id,
            type: sourceType(source.type),
            url: source.url ?? null,
            username: source.username ?? null,
            status: sourceStatus(source.status),
          },
          update: {
            clubId: club.id,
            type: sourceType(source.type),
            url: source.url ?? null,
            username: source.username ?? null,
            status: sourceStatus(source.status),
          },
        });
      }
    }
  }

  public async listSources(
    options: { dueAt?: Date; ignoreSchedule?: boolean } = {},
  ) {
    const sources = await this.db.muClubSource.findMany({
      where: {
        status: MuClubSourceStatus.ACTIVE,
        club: { status: MuClubSourceStatus.ACTIVE },
      },
      include: { club: true },
      orderBy: [{ club: { name: 'asc' } }, { id: 'asc' }],
    });
    if (options.ignoreSchedule) return sources;
    const now = options.dueAt ?? new Date();
    return sources.filter((source) => {
      if (!source.lastCheckedAt) return true;
      const interval =
        source.type === MuClubSourceType.INSTAGRAM
          ? 2 * 60 * 60_000
          : 4 * 60 * 60_000;
      return now.getTime() - source.lastCheckedAt.getTime() >= interval;
    });
  }

  public async claimRun(trigger: 'MANUAL' | 'SCHEDULED') {
    const now = new Date();
    await this.db.muMonitorState.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', nextRunAt: now },
      update: {},
    });
    const claimed = await this.db.muMonitorState.updateMany({
      where: {
        id: 'singleton',
        OR: [
          { runInProgress: false },
          { runStartedAt: { lt: new Date(now.getTime() - 2 * 60 * 60_000) } },
        ],
      },
      data: { runInProgress: true, runStartedAt: now },
    });
    if (claimed.count === 0) return undefined;
    return this.db.muMonitorRun.create({
      data: {
        trigger:
          trigger === 'MANUAL' ? RunTrigger.MANUAL : RunTrigger.SCHEDULED,
      },
    });
  }

  public async finishRun(
    runId: string,
    input: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
      sourceCount: number;
      fetchedCount: number;
      activityCount: number;
      sourceFailures: number;
      error?: string;
      nextRunAt: Date;
    },
  ) {
    await this.db.$transaction([
      this.db.muMonitorRun.update({
        where: { id: runId },
        data: {
          status: MuMonitorRunStatus[input.status],
          finishedAt: new Date(),
          sourceCount: input.sourceCount,
          fetchedCount: input.fetchedCount,
          activityCount: input.activityCount,
          sourceFailures: input.sourceFailures,
          error: input.error ?? null,
        },
      }),
      this.db.muMonitorState.update({
        where: { id: 'singleton' },
        data: {
          runInProgress: false,
          runStartedAt: null,
          lastRunAt: new Date(),
          nextRunAt: input.nextRunAt,
        },
      }),
    ]);
  }

  public async recordSourceRun(
    runId: string,
    sourceId: string,
    input: {
      success: boolean;
      itemCount: number;
      durationMs: number;
      error?: string;
    },
  ) {
    const now = new Date();
    await this.db.$transaction([
      this.db.muSourceRun.create({
        data: { monitorRunId: runId, sourceId, ...input },
      }),
      this.db.muClubSource.update({
        where: { id: sourceId },
        data: {
          lastCheckedAt: now,
          ...(input.success
            ? { lastSuccessfulAt: now, lastError: null }
            : { lastError: input.error ?? 'Unknown source failure' }),
        },
      }),
    ]);
  }

  public async saveActivity(
    clubId: string,
    sourceId: string,
    candidate: Parameters<typeof activityContentHash>[1],
    activity: ClassifiedActivity,
  ) {
    const contentHash = activityContentHash(clubId, candidate);
    const existing = await this.db.muClubActivity.findFirst({
      where: {
        OR: [
          { sourceId, externalItemId: candidate.externalItemId },
          { clubId, contentHash },
        ],
      },
    });
    if (existing) return { activity: existing, created: false };
    try {
      const created = await this.db.muClubActivity.create({
        data: {
          clubId,
          sourceId,
          externalItemId: candidate.externalItemId,
          contentHash,
          type: MuClubActivityType[activity.type],
          title: activity.title,
          summary: activity.summary,
          sourceUrl: candidate.sourceUrl,
          publishedAt: candidate.publishedAt ?? null,
          startAt: activity.startAt ?? null,
          deadlineAt: activity.deadlineAt ?? null,
          location: activity.location ?? null,
          signupUrl: activity.signupUrl ?? null,
          importance: activity.importance,
          confidence: activity.confidence,
          raw: json({
            source: candidate.raw ?? candidate,
            classification: activity,
          }),
        },
      });
      return { activity: created, created: true };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.db.muClubActivity.findFirstOrThrow({
          where: {
            OR: [
              { sourceId, externalItemId: candidate.externalItemId },
              { clubId, contentHash },
            ],
          },
        });
        return { activity: concurrent, created: false };
      }
      throw error;
    }
  }

  public listActivities(
    input: {
      since?: Date;
      club?: string;
      minimumImportance?: number;
      limit?: number;
    } = {},
  ) {
    return this.db.muClubActivity.findMany({
      where: {
        ...(input.since ? { detectedAt: { gt: input.since } } : {}),
        ...(input.club ? { club: { slug: input.club } } : {}),
        ...(input.minimumImportance
          ? { importance: { gte: input.minimumImportance } }
          : {}),
      },
      include: { club: true, source: true },
      orderBy: [{ detectedAt: 'desc' }, { importance: 'desc' }],
      take: Math.min(500, Math.max(1, input.limit ?? 100)),
    });
  }

  public listClubs() {
    return this.db.muClub.findMany({
      include: { sources: true },
      orderBy: { name: 'asc' },
    });
  }
  public monitorState() {
    return this.db.muMonitorState.findUnique({ where: { id: 'singleton' } });
  }
}
