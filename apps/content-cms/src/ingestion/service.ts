import { createHash } from 'node:crypto';
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload';
import type { IngestibleCollection } from '../collections/ingestion';
import { hostnameOf } from '../collections/sources';
import type { ReviewStatus } from '../fields/editorial';
import { zodDetails } from '../lib/http';
import { asText, canonicalJson } from '../lib/equality';
import { lexicalToText } from '../lib/lexical';
import { disambiguateSlug } from '../lib/slug';
import type { IngestAdapter } from './adapters';
import { blockedDomainsGeneration } from './blocklist';
import { writeLiveFields } from './live';
import { planMerge } from './merge';
import type { IngestItemResult, IngestRunResponse } from './schemas';

export type IngestRequestContext = {
  botId: string;
  credentialKeyId: string;
  requestId: string;
  idempotencyKey?: string;
};

export class IngestConflictError extends Error {}

type Snapshot = {
  managed: Record<string, unknown>;
  internal: Record<string, unknown>;
};
type RecordDoc = {
  id: string;
  targetId: string;
  snapshot: Snapshot;
  snapshotHash: string;
};
type TargetDoc = Record<string, unknown> & {
  id: string;
  title?: string;
  slug?: string;
  reviewStatus?: ReviewStatus;
  criticalUpdatePendingSince?: string | null;
  lastVerifiedAt?: string | null;
};
type RunDoc = {
  id: string;
  status: IngestRunResponse['status'];
  targetCollection: string;
  startedAt: string;
  completedAt?: string | null;
  received?: number | null;
  created?: number | null;
  updated?: number | null;
  proposed?: number | null;
  skipped?: number | null;
  failed?: number | null;
  results?: unknown;
};

const VERIFIED_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LIMIT = 2000;

export const snapshotHash = (snapshot: Snapshot): string =>
  createHash('sha256').update(canonicalJson(snapshot)).digest('hex');

const preview = (value: unknown, rich: boolean): string => {
  if (value === null || value === undefined || value === '') return '(empty)';
  const text = rich
    ? (lexicalToText(value) ?? '(empty)')
    : Array.isArray(value)
      ? value.map(String).join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : asText(value);
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT)}…`
    : text;
};

export const runToResponse = (run: RunDoc): IngestRunResponse => ({
  runId: String(run.id),
  status: run.status,
  collection: run.targetCollection,
  startedAt: new Date(run.startedAt).toISOString(),
  completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
  counts: {
    received: run.received ?? 0,
    created: run.created ?? 0,
    updated: run.updated ?? 0,
    proposed: run.proposed ?? 0,
    skipped: run.skipped ?? 0,
    failed: run.failed ?? 0,
  },
  results: Array.isArray(run.results)
    ? (run.results as IngestItemResult[])
    : [],
});

/**
 * Idempotent, human-edit-preserving upserts for bot content. Each item runs in
 * its own database transaction; the unique `identity` on ingestion records and
 * the unique slug constraint enforce idempotency in PostgreSQL.
 */
export class IngestionService {
  readonly #locks = new Map<string, Promise<unknown>>();
  #blockedDomains:
    { domains: Set<string>; loadedAt: number; generation: number } | undefined;

  public constructor(
    private readonly payload: Payload,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async findRun(
    id: string,
    botId: string,
  ): Promise<IngestRunResponse | null> {
    const run = (await this.payload.findByID({
      collection: 'ingestion-runs',
      id,
      overrideAccess: true,
      disableErrors: true,
      depth: 0,
    })) as (RunDoc & { botId: string }) | null;
    return run && run.botId === botId ? runToResponse(run) : null;
  }

  public async ingestBatch(
    adapter: IngestAdapter<never>,
    items: unknown[],
    context: IngestRequestContext,
  ): Promise<{ run: IngestRunResponse; replayed: boolean }> {
    if (context.idempotencyKey) {
      const previous = await this.payload.find({
        collection: 'ingestion-runs',
        where: {
          and: [
            { botId: { equals: context.botId } },
            { idempotencyKey: { equals: context.idempotencyKey } },
          ],
        },
        limit: 1,
        overrideAccess: true,
        depth: 0,
      });
      const existing = previous.docs[0] as RunDoc | undefined;
      if (existing) {
        if (existing.status === 'running')
          throw new IngestConflictError(
            'A request with this Idempotency-Key is still running',
          );
        return { run: runToResponse(existing), replayed: true };
      }
    }
    const startedAt = this.now();
    let run: RunDoc;
    try {
      run = await this.payload.create({
        collection: 'ingestion-runs',
        data: {
          botId: context.botId,
          credentialKeyId: context.credentialKeyId,
          targetCollection: adapter.collection,
          idempotencyKey: context.idempotencyKey ?? null,
          requestId: context.requestId,
          startedAt: startedAt.toISOString(),
          status: 'running',
          received: items.length,
        },
        overrideAccess: true,
        depth: 0,
      });
    } catch (error) {
      if (context.idempotencyKey)
        throw new IngestConflictError('Duplicate Idempotency-Key');
      throw error;
    }

    const results: IngestItemResult[] = [];
    for (const [index, raw] of items.entries()) {
      results.push(await this.ingestOne(adapter, raw, index, run.id, context));
    }
    const count = (outcome: IngestItemResult['outcome']) =>
      results.filter((result) => result.outcome === outcome).length;
    const failed = count('failed');
    const status: IngestRunResponse['status'] =
      failed === 0
        ? 'succeeded'
        : failed === results.length
          ? 'failed'
          : 'partial';
    const finished = (await this.payload.update({
      collection: 'ingestion-runs',
      id: run.id,
      data: {
        status,
        completedAt: this.now().toISOString(),
        created: count('created'),
        updated: count('updated'),
        proposed: count('proposed'),
        skipped: count('skipped') + count('unchanged'),
        failed,
        results,
        errors: failed
          ? results.filter((result) => result.outcome === 'failed')
          : null,
      },
      overrideAccess: true,
      depth: 0,
    })) as RunDoc;
    const response = runToResponse(finished);
    this.payload.logger.info(
      {
        audit: 'ingestion',
        botId: context.botId,
        keyId: context.credentialKeyId,
        requestId: context.requestId,
        runId: response.runId,
        collection: adapter.collection,
        status,
        counts: response.counts,
      },
      'Ingestion run completed',
    );
    return { run: response, replayed: false };
  }

  private async ingestOne(
    adapter: IngestAdapter<never>,
    raw: unknown,
    index: number,
    runId: string,
    context: IngestRequestContext,
  ): Promise<IngestItemResult> {
    const externalIdRaw = (raw as { externalId?: unknown } | null)?.externalId;
    const externalId =
      typeof externalIdRaw === 'string' ? externalIdRaw.slice(0, 200) : null;
    const parsed = adapter.schema.safeParse(raw);
    if (!parsed.success) {
      return {
        index,
        externalId,
        outcome: 'failed',
        reason: 'validation_failed',
        retryable: false,
        details: zodDetails(parsed.error.issues),
      };
    }
    const item = parsed.data as { externalId: string };
    if (await this.isBlocked(adapter.sourceUrls(item as never))) {
      return {
        index,
        externalId: item.externalId,
        outcome: 'skipped',
        reason: 'source_blocked',
      };
    }
    const identity = `${adapter.collection}:${context.botId}:${item.externalId}`;
    try {
      return await this.withLock(identity, () =>
        this.upsert(adapter, item, identity, index, runId, context),
      );
    } catch (error) {
      this.payload.logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          identity,
          requestId: context.requestId,
        },
        'Ingestion item failed',
      );
      return {
        index,
        externalId: item.externalId,
        outcome: 'failed',
        reason: 'internal_error',
        retryable: true,
      };
    }
  }

  private async upsert(
    adapter: IngestAdapter<never>,
    item: { externalId: string },
    identity: string,
    index: number,
    runId: string,
    context: IngestRequestContext,
  ): Promise<IngestItemResult> {
    const req = await createLocalReq(
      { context: { ingestion: true } },
      this.payload,
    );
    await initTransaction(req);
    try {
      const result = await this.upsertInTransaction(
        req,
        adapter,
        item,
        identity,
        index,
        runId,
        context,
      );
      await commitTransaction(req);
      return result;
    } catch (error) {
      await killTransaction(req);
      throw error;
    }
  }

  private async upsertInTransaction(
    req: PayloadRequest,
    adapter: IngestAdapter<never>,
    item: { externalId: string },
    identity: string,
    index: number,
    runId: string,
    context: IngestRequestContext,
  ): Promise<IngestItemResult> {
    const payload = this.payload;
    const collection = adapter.collection;
    const now = this.now().toISOString();
    const snapshot: Snapshot = {
      managed: adapter.toManaged(item as never),
      internal: adapter.toInternal(item as never),
    };
    const hash = snapshotHash(snapshot);
    const verifiedAt = adapter.verifiedAt?.(item as never);
    const base = { index, externalId: item.externalId };

    const existing = await payload.find({
      collection: 'ingestion-records',
      where: { identity: { equals: identity } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    });
    const record = existing.docs[0] as RecordDoc | undefined;

    if (!record) {
      const slug = await this.uniqueSlug(
        req,
        collection,
        adapter.baseSlug(item as never),
        identity,
      );
      const created = (await payload.create({
        collection,
        draft: true,
        data: {
          ...snapshot.managed,
          ...snapshot.internal,
          ...(slug ? { slug } : {}),
          reviewStatus: 'ingested',
          sourceBot: context.botId,
          externalId: item.externalId,
          hasPendingUpdates: false,
          ...(collection === 'events' && verifiedAt
            ? { lastVerifiedAt: verifiedAt }
            : {}),
        } as never,
        depth: 0,
        overrideAccess: true,
        context: { ingestion: true },
        req,
      })) as unknown as TargetDoc;
      await payload.create({
        collection: 'ingestion-records',
        data: {
          identity,
          targetCollection: collection,
          targetId: String(created.id),
          sourceBot: context.botId,
          externalId: item.externalId,
          snapshot,
          snapshotHash: hash,
          firstSeenAt: now,
          lastSeenAt: now,
          lastChangedAt: now,
          lastRun: runId,
        },
        depth: 0,
        overrideAccess: true,
        req,
      });
      return {
        ...base,
        outcome: 'created',
        id: String(created.id),
        ...(slug ? { slug } : {}),
      };
    }

    const touchRecord = (data: Record<string, unknown>) =>
      payload.update({
        collection: 'ingestion-records',
        id: record.id,
        data: { lastSeenAt: now, lastRun: runId, ...data },
        depth: 0,
        overrideAccess: true,
        req,
      });

    if (record.snapshotHash === hash) {
      await touchRecord({});
      if (collection === 'events' && verifiedAt)
        await this.touchVerified(req, record.targetId, verifiedAt);
      return { ...base, outcome: 'unchanged', id: record.targetId };
    }

    const target = (await payload.findByID({
      collection,
      id: record.targetId,
      draft: true,
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
      req,
    })) as unknown as TargetDoc | null;
    await touchRecord({ snapshot, snapshotHash: hash, lastChangedAt: now });
    if (!target)
      return {
        ...base,
        outcome: 'skipped',
        reason: 'target_deleted',
        id: record.targetId,
      };

    const live = (await payload.db.findOne({
      collection,
      where: { id: { equals: target.id } },
      req,
    })) as { _status?: string } | null;
    const reviewStatus = target.reviewStatus ?? 'needs_review';
    const plan = planMerge({
      incoming: snapshot.managed,
      snapshot: record.snapshot?.managed ?? {},
      editorial: Object.fromEntries(
        adapter.managedFields.map((field) => [field, target[field]]),
      ),
      reviewStatus,
      livePublished: live?._status === 'published',
      richTextFields: adapter.richTextFields,
      criticalFields: adapter.criticalFields,
    });
    const ids = {
      id: String(target.id),
      ...(target.slug ? { slug: target.slug } : {}),
    };
    if (plan.kind === 'unchanged' || reviewStatus === 'rejected') {
      return {
        ...base,
        ...ids,
        outcome: 'unchanged',
        ...(reviewStatus === 'rejected'
          ? { reason: 'rejected_by_editor' }
          : {}),
      };
    }

    const hasAutoApply = Object.keys(plan.autoApply).length > 0;
    const hasProposals = Object.keys(plan.proposals).length > 0;
    const criticalSince = plan.critical
      ? (target.criticalUpdatePendingSince ?? now)
      : undefined;
    const draftData: Record<string, unknown> = {
      ...plan.autoApply,
      ...(hasAutoApply ? snapshot.internal : {}),
      ...(hasProposals ? { hasPendingUpdates: true } : {}),
      ...(criticalSince ? { criticalUpdatePendingSince: criticalSince } : {}),
      ...(collection === 'events' && verifiedAt && hasAutoApply
        ? { lastVerifiedAt: verifiedAt }
        : {}),
    };
    if (Object.keys(draftData).length > 0) {
      await payload.update({
        collection,
        id: target.id,
        draft: true,
        data: draftData,
        depth: 0,
        overrideAccess: true,
        context: { ingestion: true },
        req,
      });
    }
    await writeLiveFields(req, collection, String(target.id), {
      ...plan.liveCorrections,
      ...(hasProposals ? { hasPendingUpdates: true } : {}),
      ...(criticalSince ? { criticalUpdatePendingSince: criticalSince } : {}),
      ...(Object.keys(plan.liveCorrections).length &&
      collection === 'events' &&
      verifiedAt
        ? { lastVerifiedAt: verifiedAt }
        : {}),
    });
    if (hasProposals || plan.overrides.length > 0) {
      await this.recordPendingUpdate(
        req,
        adapter,
        target,
        plan,
        runId,
        context.botId,
      );
    }
    if (Object.keys(plan.liveCorrections).length > 0) {
      payload.logger.warn(
        {
          collection,
          id: target.id,
          fields: Object.keys(plan.liveCorrections),
          overrides: plan.overrides,
        },
        'Applied safety correction to published content',
      );
    }
    return {
      ...base,
      ...ids,
      outcome: hasAutoApply
        ? 'updated'
        : hasProposals
          ? 'proposed'
          : 'unchanged',
    };
  }

  private async recordPendingUpdate(
    req: PayloadRequest,
    adapter: IngestAdapter<never>,
    target: TargetDoc,
    plan: Extract<ReturnType<typeof planMerge>, { kind: 'changed' }>,
    runId: string,
    botId: string,
  ): Promise<void> {
    const rich = (field: string) => adapter.richTextFields.includes(field);
    const incoming = Object.entries(plan.proposals).map(([field, change]) => ({
      field,
      currentPreview: preview(change.current, rich(field)),
      proposedPreview: preview(change.proposed, rich(field)),
      proposedValue: { value: change.proposed ?? null },
      apply: true,
    }));
    const open = await this.payload.find({
      collection: 'pending-updates',
      where: {
        and: [
          { targetCollection: { equals: adapter.collection } },
          { targetId: { equals: String(target.id) } },
          { status: { equals: 'pending' } },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    });
    const current = open.docs[0] as
      | {
          id: string;
          severity?: string;
          changes?: Array<{ field: string }>;
          autoApplied?: unknown;
        }
      | undefined;
    const replaced = new Set(incoming.map((change) => change.field));
    const changes = [
      ...(current?.changes ?? [])
        .filter((change) => !replaced.has(change.field))
        .map(({ field, ...rest }) => ({ field, ...rest, id: undefined })),
      ...incoming,
    ];
    const autoApplied = [
      ...new Set([
        ...(Array.isArray(current?.autoApplied)
          ? (current.autoApplied as string[])
          : []),
        ...plan.overrides,
      ]),
    ];
    const data = {
      title:
        `${adapter.collection}: ${String(target.title ?? target.id)}`.slice(
          0,
          300,
        ),
      targetCollection: adapter.collection,
      targetId: String(target.id),
      sourceBot: botId,
      status: 'pending' as const,
      severity:
        plan.critical ||
        plan.overrides.length > 0 ||
        current?.severity === 'critical'
          ? ('critical' as const)
          : ('normal' as const),
      changes,
      autoApplied,
      ingestionRun: runId,
    };
    if (current) {
      await this.payload.update({
        collection: 'pending-updates',
        id: current.id,
        data,
        depth: 0,
        overrideAccess: true,
        req,
        context: { system: true },
      });
    } else {
      await this.payload.create({
        collection: 'pending-updates',
        data,
        depth: 0,
        overrideAccess: true,
        req,
        context: { system: true },
      });
    }
  }

  private async touchVerified(
    req: PayloadRequest,
    id: string,
    verifiedAt: string,
  ): Promise<void> {
    const live = (await this.payload.db.findOne({
      collection: 'events',
      where: { id: { equals: id } },
      req,
    })) as {
      _status?: string;
      lastVerifiedAt?: string | null;
    } | null;
    if (live?._status !== 'published') return;
    const previous = live.lastVerifiedAt
      ? new Date(live.lastVerifiedAt).getTime()
      : 0;
    if (new Date(verifiedAt).getTime() - previous < VERIFIED_TOUCH_INTERVAL_MS)
      return;
    await this.payload.db.updateOne({
      collection: 'events',
      id,
      data: { lastVerifiedAt: verifiedAt },
      req,
      returning: false,
    });
  }

  private async uniqueSlug(
    req: PayloadRequest,
    collection: IngestibleCollection,
    base: string | null,
    identity: string,
  ): Promise<string | null> {
    if (!base) return null;
    const taken = async (slug: string) =>
      (
        await this.payload.count({
          collection: collection as 'events',
          where: { slug: { equals: slug } },
          overrideAccess: true,
          req,
        })
      ).totalDocs > 0;
    if (!(await taken(base))) return base;
    const alternative = disambiguateSlug(base, identity);
    if (!(await taken(alternative))) return alternative;
    return disambiguateSlug(alternative, `${identity}:${Date.now()}`);
  }

  private async isBlocked(urls: string[]): Promise<boolean> {
    if (urls.length === 0) return false;
    const nowMs = Date.now();
    if (
      !this.#blockedDomains ||
      nowMs - this.#blockedDomains.loadedAt > 60_000 ||
      this.#blockedDomains.generation !== blockedDomainsGeneration()
    ) {
      const blocked = await this.payload.find({
        collection: 'sources',
        where: { ingestionBlocked: { equals: true } },
        pagination: false,
        depth: 0,
        overrideAccess: true,
        select: { domain: true },
      });
      this.#blockedDomains = {
        loadedAt: nowMs,
        generation: blockedDomainsGeneration(),
        domains: new Set(
          blocked.docs
            .map((doc) => (doc as { domain?: string }).domain)
            .filter((domain): domain is string => Boolean(domain)),
        ),
      };
    }
    const domains = this.#blockedDomains.domains;
    return urls.some((url) => {
      const host = hostnameOf(url);
      return (
        host !== null &&
        [...domains].some(
          (domain) => host === domain || host.endsWith(`.${domain}`),
        )
      );
    });
  }

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.#locks.set(key, settled);
    try {
      return await next;
    } finally {
      if (this.#locks.get(key) === settled) this.#locks.delete(key);
    }
  }
}
