import { createHash } from 'node:crypto';
import type { SocialsStore } from '@watcher/database';
import type { NotionClient } from '@watcher/notion';

type SyncItem = Awaited<
  ReturnType<SocialsStore['listPendingNotionItems']>
>[number];

const richText = (value: string): Record<string, unknown>[] =>
  value
    .match(/[\s\S]{1,2000}/gu)
    ?.slice(0, 40)
    .map((content) => ({
      type: 'text',
      text: { content },
    })) ?? [];

const plainText = (value: unknown): string => {
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.plain_text === 'string') return [record.plain_text];
      return [];
    })
    .join('');
};

const propertyRecord = (
  page: Record<string, unknown>,
  name: string,
): Record<string, unknown> => {
  const properties = page.properties;
  if (!properties || typeof properties !== 'object') return {};
  const value = (properties as Record<string, unknown>)[name];
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
};

const selectedName = (
  page: Record<string, unknown>,
  name: string,
): string | undefined => {
  const select = propertyRecord(page, name).select;
  if (!select || typeof select !== 'object') return undefined;
  const value = (select as Record<string, unknown>).name;
  return typeof value === 'string' ? value : undefined;
};

const urlValue = (
  page: Record<string, unknown>,
  name: string,
): string | undefined => {
  const value = propertyRecord(page, name).url;
  return typeof value === 'string' ? value : undefined;
};

const dateValue = (
  page: Record<string, unknown>,
  name: string,
): Date | undefined => {
  const date = propertyRecord(page, name).date;
  if (!date || typeof date !== 'object') return undefined;
  const value = (date as Record<string, unknown>).start;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const contentHash = (item: SyncItem): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        title: item.title,
        channel: item.channel,
        format: item.format,
        status: item.status,
        plannedAt: item.plannedAt,
        publishedAt: item.publishedAt,
        prompt: item.prompt,
        draft: item.draft,
        finalContent: item.finalContent,
        publishedUrl: item.publishedUrl,
        topics: item.topics.map(({ topic }) => topic.name),
        projects: item.projects
          .filter(({ project }) => project.visibility === 'PUBLIC')
          .map(({ project }) => project.name),
      }),
    )
    .digest('hex');

const pageProperties = (item: SyncItem): Record<string, unknown> => ({
  Name: { title: richText(item.title) },
  'Local ID': { rich_text: richText(item.id) },
  Channel: { select: { name: item.channel } },
  Format: { select: { name: item.format } },
  Status: { select: { name: item.status } },
  'Planned Date': {
    date: item.plannedAt ? { start: item.plannedAt.toISOString() } : null,
  },
  'Published Date': {
    date: item.publishedAt ? { start: item.publishedAt.toISOString() } : null,
  },
  Projects: {
    multi_select: item.projects
      .filter(({ project }) => project.visibility === 'PUBLIC')
      .map(({ project }) => ({ name: project.name.slice(0, 100) })),
  },
  Topics: {
    multi_select: item.topics.map(({ topic }) => ({
      name: topic.name.slice(0, 100),
    })),
  },
  Pillar: { select: { name: item.contentPillar } },
  Objective: { select: { name: item.objective } },
  Prompt: { rich_text: richText(item.prompt ?? '') },
  Draft: { rich_text: richText(item.draft ?? '') },
  'Final Content': { rich_text: richText(item.finalContent ?? '') },
  'Published URL': { url: item.publishedUrl ?? null },
  'Source Links': {
    rich_text: richText(
      item.sources
        .flatMap(({ source }) => (source.url ? [source.url] : []))
        .join('\n'),
    ),
  },
});

const notionStatus = (value: string | undefined) => {
  const valid = new Set([
    'IDEA',
    'PLANNED',
    'PROMPT_READY',
    'DRAFT',
    'READY',
    'SCHEDULED',
    'PUBLISHED',
    'SKIPPED',
    'ARCHIVED',
  ]);
  return value && valid.has(value)
    ? (value as
        | 'IDEA'
        | 'PLANNED'
        | 'PROMPT_READY'
        | 'DRAFT'
        | 'READY'
        | 'SCHEDULED'
        | 'PUBLISHED'
        | 'SKIPPED'
        | 'ARCHIVED')
    : undefined;
};

export class SocialNotionSync {
  public constructor(
    private readonly store: SocialsStore,
    private readonly client: NotionClient,
    private readonly dataSourceId: string,
  ) {}

  public async synchronize(ownerUserId: bigint): Promise<{
    synced: number;
    conflicts: number;
    failed: number;
  }> {
    const result = { synced: 0, conflicts: 0, failed: 0 };
    const items = await this.store.listPendingNotionItems(ownerUserId);
    for (const item of items) {
      const hash = contentHash(item);
      const key = {
        ownerUserId,
        localEntityType: 'CONTENT_ITEM',
        localEntityId: item.id,
        provider: 'NOTION',
      };
      const sync = await this.store.getExternalSync(key);
      try {
        if (!sync || sync.externalId.startsWith('pending:')) {
          const page = await this.client.createPage(
            {
              parent: {
                type: 'data_source_id',
                data_source_id: this.dataSourceId,
              },
              properties: pageProperties(item),
            },
            AbortSignal.timeout(30_000),
          );
          if (typeof page.id !== 'string') {
            throw new Error('Notion did not return a page ID');
          }
          await this.store.saveExternalSync({
            ...key,
            externalId: page.id,
            lastLocalHash: hash,
            ...(typeof page.last_edited_time === 'string'
              ? { lastRemoteEditedAt: new Date(page.last_edited_time) }
              : {}),
            status: 'SYNCED',
          });
          result.synced += 1;
          continue;
        }
        const page = await this.client.retrievePage(
          sync.externalId,
          AbortSignal.timeout(30_000),
        );
        const remoteEditedAt =
          typeof page.last_edited_time === 'string'
            ? new Date(page.last_edited_time)
            : undefined;
        const remoteChanged =
          remoteEditedAt &&
          sync.lastSyncedAt &&
          remoteEditedAt.getTime() > sync.lastSyncedAt.getTime() + 1_000;
        const localChanged = sync.lastLocalHash !== hash;
        if (remoteChanged && localChanged) {
          await this.store.saveExternalSync({
            ...key,
            externalId: sync.externalId,
            ...(sync.lastLocalHash
              ? { lastLocalHash: sync.lastLocalHash }
              : {}),
            lastRemoteEditedAt: remoteEditedAt,
            status: 'CONFLICT',
            lastError:
              'Notion i lokální záznam se změnily. Automatické přepsání bylo zastaveno.',
          });
          result.conflicts += 1;
          continue;
        }
        if (remoteChanged && !localChanged) {
          const draft = plainText(propertyRecord(page, 'Draft').rich_text);
          const finalContent = plainText(
            propertyRecord(page, 'Final Content').rich_text,
          );
          const status = notionStatus(selectedName(page, 'Status'));
          if (draft && draft !== item.draft) {
            await this.store.saveContentVersion({
              ownerUserId,
              contentItemId: item.id,
              content: draft,
              source: 'NOTION',
              status: status ?? 'DRAFT',
            });
          }
          if (finalContent && finalContent !== item.finalContent) {
            await this.store.saveContentVersion({
              ownerUserId,
              contentItemId: item.id,
              content: finalContent,
              source: 'NOTION',
              status: status ?? 'READY',
              final: true,
            });
          }
          const publishedUrl = urlValue(page, 'Published URL');
          if (status && status !== 'PUBLISHED') {
            await this.store.updateContentStatus({
              ownerUserId,
              contentItemId: item.id,
              status,
              ...(dateValue(page, 'Planned Date')
                ? { scheduledAt: dateValue(page, 'Planned Date')! }
                : {}),
            });
          } else if (status === 'PUBLISHED' && publishedUrl) {
            await this.store.updateContentStatus({
              ownerUserId,
              contentItemId: item.id,
              status,
              publishedAt: dateValue(page, 'Published Date') ?? new Date(),
              publishedUrl,
            });
          }
          await this.store.saveExternalSync({
            ...key,
            externalId: sync.externalId,
            lastLocalHash: hash,
            ...(remoteEditedAt ? { lastRemoteEditedAt: remoteEditedAt } : {}),
            status: 'SYNCED',
          });
          result.synced += 1;
          continue;
        }
        if (localChanged) {
          const updated = await this.client.updatePage(
            sync.externalId,
            { properties: pageProperties(item) },
            AbortSignal.timeout(30_000),
          );
          await this.store.saveExternalSync({
            ...key,
            externalId: sync.externalId,
            lastLocalHash: hash,
            ...(typeof updated.last_edited_time === 'string'
              ? { lastRemoteEditedAt: new Date(updated.last_edited_time) }
              : remoteEditedAt
                ? { lastRemoteEditedAt: remoteEditedAt }
                : {}),
            status: 'SYNCED',
          });
        }
        result.synced += 1;
      } catch (error) {
        result.failed += 1;
        await this.store.saveExternalSync({
          ...key,
          externalId: sync?.externalId ?? `pending:${item.id}`,
          ...(sync?.lastLocalHash ? { lastLocalHash: sync.lastLocalHash } : {}),
          status: 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }
}
