import {
  APIError,
  Forbidden,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeChangeHook,
} from 'payload';
import { canPublish, roleOf } from '../access/roles';
import type { ReviewStatus } from '../fields/editorial';
import { sameValue } from '../lib/equality';
import { requestRevalidation } from '../lib/revalidate';

type EditorialDoc = {
  id: string | number;
  slug?: string | null;
  reviewStatus?: ReviewStatus | null;
  _status?: 'draft' | 'published' | null;
  humanEditedFields?: unknown;
};

const DECISIONS: ReviewStatus[] = ['approved', 'rejected', 'archived'];
const PUBLICLY_VISIBLE: ReviewStatus[] = ['approved', 'archived'];

export type EditorialContext = {
  /** Writes performed by the ingestion service on behalf of a bot. */
  ingestion?: boolean;
  /** Internal follow-up writes that must not re-trigger workflow hooks. */
  skipEditorialHooks?: boolean;
};

/**
 * Server-side publication policy. It runs for the admin UI, REST, Local API,
 * bulk edits, and scheduled publish jobs alike.
 */
export const enforceEditorialWorkflow: CollectionBeforeChangeHook<
  EditorialDoc
> = ({ context, data, originalDoc, req }) => {
  if ((context as EditorialContext).skipEditorialHooks) return data;
  const human = roleOf(req.user);
  const previousReview = originalDoc?.reviewStatus ?? undefined;
  const nextReview: ReviewStatus =
    data.reviewStatus ?? previousReview ?? 'needs_review';
  const wasPublished = originalDoc?._status === 'published';
  const nextStatus = data._status ?? originalDoc?._status ?? 'draft';

  if (human && nextReview !== previousReview) {
    const decides = DECISIONS.includes(nextReview);
    const revisesDecision =
      previousReview !== undefined && DECISIONS.includes(previousReview);
    if ((decides || revisesDecision) && !canPublish(req)) {
      throw new Forbidden(req.t);
    }
  }
  if (
    (context as EditorialContext).ingestion &&
    data.reviewStatus !== undefined &&
    originalDoc
  ) {
    // Bots never change an existing editorial decision.
    data.reviewStatus = originalDoc.reviewStatus ?? 'ingested';
  }

  if (nextStatus === 'published') {
    if (!PUBLICLY_VISIBLE.includes(nextReview)) {
      if (wasPublished) {
        // Rejecting or reopening review of live content unpublishes it.
        data._status = 'draft';
        data.reviewStatus = nextReview;
        return data;
      }
      throw new APIError(
        'Only approved content can be published. Set Review status to Approved first.',
        400,
        undefined,
        true,
      );
    }
    if (nextReview === 'archived' && !wasPublished) {
      throw new APIError(
        'Archived content cannot be newly published.',
        400,
        undefined,
        true,
      );
    }
    if (req.user && !canPublish(req)) throw new Forbidden(req.t);
    if (!req.user && (context as EditorialContext).ingestion && !wasPublished) {
      throw new APIError('Bots cannot publish content.', 403, undefined, true);
    }
  }
  return data;
};

/**
 * Tracks which bot-managed fields a human changed. Ingestion uses snapshots to
 * protect them; this marker makes the protection visible to editors.
 */
export const trackHumanEdits =
  (
    managedFields: readonly string[],
  ): CollectionBeforeChangeHook<EditorialDoc> =>
  ({ context, data, operation, originalDoc, req }) => {
    if ((context as EditorialContext).skipEditorialHooks) return data;
    if (operation !== 'update' || !originalDoc || !roleOf(req.user))
      return data;
    const previous = Array.isArray(originalDoc.humanEditedFields)
      ? (originalDoc.humanEditedFields as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const edited = new Set(previous);
    const record = data as Record<string, unknown>;
    const original = originalDoc as unknown as Record<string, unknown>;
    for (const field of managedFields) {
      if (field in record && !sameValue(record[field], original[field])) {
        edited.add(field);
      }
    }
    if (edited.size !== previous.length)
      data.humanEditedFields = [...edited].sort();
    return data;
  };

/**
 * Draft saves never touch the live row. When a reviewer rejects, reopens, or
 * archives already-published content through a draft save, mirror that
 * decision onto the live row so the public API reacts immediately.
 */
export const syncLiveReviewState: CollectionAfterChangeHook<
  EditorialDoc
> = async ({ collection, context, doc, operation, req }) => {
  if (
    (context as EditorialContext).skipEditorialHooks ||
    operation !== 'update'
  )
    return doc;
  if (doc._status === 'published') return doc;
  const live = await req.payload.db.findOne<EditorialDoc>({
    collection: collection.slug,
    where: { id: { equals: doc.id } },
    req,
  });
  if (
    !live ||
    live._status !== 'published' ||
    live.reviewStatus === doc.reviewStatus
  ) {
    return doc;
  }
  const keepLive =
    doc.reviewStatus && PUBLICLY_VISIBLE.includes(doc.reviewStatus);
  await req.payload.db.updateOne({
    collection: collection.slug,
    id: doc.id,
    data: {
      reviewStatus: doc.reviewStatus,
      ...(keepLive ? {} : { _status: 'draft' }),
      updatedAt: new Date().toISOString(),
    },
    req,
    returning: false,
  });
  req.payload.logger.info(
    {
      collection: collection.slug,
      id: doc.id,
      reviewStatus: doc.reviewStatus,
      unpublished: !keepLive,
    },
    'Mirrored review decision onto live document',
  );
  void requestRevalidation(
    req.payload,
    revalidationTags(collection.slug, live.slug ?? doc.slug),
  );
  return doc;
};

export const revalidationTags = (
  collection: string,
  slug?: string | null,
): string[] => [collection, ...(slug ? [`${collection}:${slug}`] : [])];

export const revalidateAfterChange: CollectionAfterChangeHook<EditorialDoc> = ({
  collection,
  doc,
  previousDoc,
  req,
}) => {
  if (doc._status === 'published' || previousDoc?._status === 'published') {
    const tags = revalidationTags(collection.slug, doc.slug);
    if (previousDoc?.slug && previousDoc.slug !== doc.slug) {
      tags.push(`${collection.slug}:${previousDoc.slug}`);
    }
    void requestRevalidation(req.payload, tags);
  }
  return doc;
};

export const revalidateAfterDelete: CollectionAfterDeleteHook<EditorialDoc> = ({
  collection,
  doc,
  req,
}) => {
  void requestRevalidation(
    req.payload,
    revalidationTags(collection.slug, doc.slug),
  );
  return doc;
};
