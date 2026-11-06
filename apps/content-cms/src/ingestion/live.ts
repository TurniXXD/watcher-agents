import type { PayloadRequest } from 'payload';
import type { IngestibleCollection } from '../collections/ingestion';
import { revalidationTags } from '../hooks/editorial';
import { requestRevalidation } from '../lib/revalidate';

/**
 * Writes fields directly onto the live (published) row without creating a
 * version or merging unpublished drafts. Used only for safety corrections and
 * operational markers that the public API reads. Returns whether the row was live.
 */
export const writeLiveFields = async (
  req: PayloadRequest,
  collection: IngestibleCollection,
  id: string,
  fields: Record<string, unknown>,
): Promise<boolean> => {
  if (Object.keys(fields).length === 0) return false;
  const live = (await req.payload.db.findOne({
    collection,
    where: { id: { equals: id } },
    req,
  })) as { _status?: string; slug?: string } | null;
  if (live?._status !== 'published') return false;
  await req.payload.db.updateOne({
    collection,
    id,
    data: { ...fields, updatedAt: new Date().toISOString() },
    req,
    returning: false,
  });
  void requestRevalidation(
    req.payload,
    revalidationTags(collection, live.slug),
  );
  return true;
};
