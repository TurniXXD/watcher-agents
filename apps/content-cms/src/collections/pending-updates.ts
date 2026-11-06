import type {
  CollectionAfterChangeHook,
  CollectionConfig,
  FieldAccess,
  PayloadRequest,
} from 'payload';
import { isAdmin, isEditorial, isStaff, nobody, roleOf } from '../access/roles';
import { statusOptions } from '../fields/editorial';
import { ingestibleCollections, type IngestibleCollection } from './ingestion';
import { writeLiveFields } from '../ingestion/live';

const neverEditable: FieldAccess = () => false;

type PendingChange = {
  field: string;
  /** Wrapped as `{ value }` because JSON fields cannot hold bare strings. */
  proposedValue?: { value?: unknown } | null;
  apply?: boolean | null;
};

type PendingUpdateDoc = {
  id: string;
  targetCollection: IngestibleCollection;
  targetId: string;
  status: 'pending' | 'applied' | 'dismissed';
  severity: 'normal' | 'critical';
  changes?: PendingChange[] | null;
};

/**
 * Applying writes the selected bot values to the target's editorial draft. A
 * reviewer then publishes as usual. Critical date fixes an editor accepts are
 * also written to the live row so the public listing is corrected at once.
 */
const resolvePendingUpdate: CollectionAfterChangeHook<
  PendingUpdateDoc
> = async ({ context, doc, previousDoc, req }) => {
  if (
    context.system ||
    previousDoc?.status !== 'pending' ||
    doc.status === 'pending'
  )
    return doc;
  const selected =
    doc.status === 'applied'
      ? (doc.changes ?? []).filter((change) => change.apply)
      : [];
  const target = (await req.payload.findByID({
    collection: doc.targetCollection,
    id: doc.targetId,
    draft: true,
    depth: 0,
    req,
    overrideAccess: true,
    disableErrors: true,
  })) as (Record<string, unknown> & { humanEditedFields?: unknown }) | null;
  if (!target) return doc;
  const values = Object.fromEntries(
    selected.map((change) => [
      change.field,
      change.proposedValue?.value ?? null,
    ]),
  );
  const humanEdited = Array.isArray(target.humanEditedFields)
    ? (target.humanEditedFields as string[]).filter(
        (field) => !(field in values),
      )
    : [];
  const markers = {
    hasPendingUpdates: false,
    ...(doc.targetCollection === 'events'
      ? { criticalUpdatePendingSince: null }
      : {}),
  };
  await req.payload.update({
    collection: doc.targetCollection,
    id: doc.targetId,
    draft: true,
    data: { ...values, ...markers, humanEditedFields: humanEdited },
    depth: 0,
    req,
    overrideAccess: true,
    context: { skipEditorialHooks: true },
  });
  const liveDates =
    doc.severity === 'critical'
      ? Object.fromEntries(
          Object.entries(values).filter(([field]) =>
            ['startsAt', 'endsAt', 'eventStatus'].includes(field),
          ),
        )
      : {};
  await writeLiveFields(req, doc.targetCollection, doc.targetId, {
    ...markers,
    ...liveDates,
  });
  return doc;
};

const stampResolution: CollectionConfig['hooks'] = {
  beforeChange: [
    ({
      data,
      originalDoc,
      req,
    }: {
      data: Partial<PendingUpdateDoc> & {
        resolvedAt?: string;
        resolvedBy?: string;
      };
      originalDoc?: PendingUpdateDoc;
      req: PayloadRequest;
    }) => {
      if (
        originalDoc?.status === 'pending' &&
        data.status &&
        data.status !== 'pending'
      ) {
        data.resolvedAt = new Date().toISOString();
        data.resolvedBy = roleOf(req.user)
          ? String((req.user as { email?: string }).email ?? req.user?.id)
          : 'system';
      }
      if (
        originalDoc &&
        originalDoc.status !== 'pending' &&
        data.status === 'pending' &&
        roleOf(req.user)
      ) {
        data.status = originalDoc.status;
      }
      return data;
    },
  ],
  afterChange: [resolvePendingUpdate],
};

export const PendingUpdates: CollectionConfig = {
  slug: 'pending-updates',
  labels: { singular: 'Pending update', plural: 'Pending Updates' },
  access: {
    read: isStaff,
    create: nobody,
    update: isEditorial,
    delete: isAdmin,
  },
  admin: {
    group: 'Operations',
    useAsTitle: 'title',
    defaultColumns: [
      'title',
      'targetCollection',
      'severity',
      'status',
      'sourceBot',
      'updatedAt',
    ],
    description:
      'Bot changes that would overwrite reviewed or human-edited content. Tick the changes to keep, then set Status to Applied (or Dismissed).',
    components: {
      beforeListTable: [
        {
          path: '/components/QuickFilters#QuickFilters',
          clientProps: {
            collection: 'pending-updates',
            filters: [
              { label: 'Pending', where: { status: { equals: 'pending' } } },
              {
                label: 'Critical',
                where: {
                  and: [
                    { status: { equals: 'pending' } },
                    { severity: { equals: 'critical' } },
                  ],
                },
              },
              { label: 'Applied', where: { status: { equals: 'applied' } } },
              {
                label: 'Dismissed',
                where: { status: { equals: 'dismissed' } },
              },
            ],
          },
        },
      ],
    },
  },
  defaultSort: '-updatedAt',
  hooks: stampResolution,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      access: { update: neverEditable },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'targetCollection',
          type: 'select',
          required: true,
          index: true,
          options: statusOptions(ingestibleCollections),
          access: { update: neverEditable },
        },
        {
          name: 'targetId',
          type: 'text',
          required: true,
          index: true,
          access: { update: neverEditable },
        },
        {
          name: 'sourceBot',
          type: 'text',
          index: true,
          access: { update: neverEditable },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          type: 'select',
          required: true,
          defaultValue: 'pending',
          index: true,
          options: statusOptions(['pending', 'applied', 'dismissed']),
        },
        {
          name: 'severity',
          type: 'select',
          required: true,
          defaultValue: 'normal',
          index: true,
          options: statusOptions(['normal', 'critical']),
          access: { update: neverEditable },
        },
      ],
    },
    {
      name: 'changes',
      type: 'array',
      access: { create: neverEditable },
      fields: [
        {
          name: 'field',
          type: 'text',
          required: true,
          access: { update: neverEditable },
        },
        {
          name: 'currentPreview',
          label: 'Current',
          type: 'textarea',
          access: { update: neverEditable },
        },
        {
          name: 'proposedPreview',
          label: 'Proposed',
          type: 'textarea',
          access: { update: neverEditable },
        },
        {
          name: 'proposedValue',
          type: 'json',
          access: { update: neverEditable },
          admin: { hidden: true },
        },
        { name: 'apply', type: 'checkbox', defaultValue: true },
      ],
    },
    {
      name: 'autoApplied',
      type: 'json',
      access: { update: neverEditable },
      admin: {
        readOnly: true,
        description:
          'Safety corrections already applied over human edits (cancellations, dates).',
      },
    },
    {
      name: 'ingestionRun',
      type: 'relationship',
      relationTo: 'ingestion-runs',
      access: { update: neverEditable },
    },
    { name: 'editorNote', type: 'textarea' },
    { name: 'resolvedAt', type: 'date', admin: { readOnly: true } },
    { name: 'resolvedBy', type: 'text', admin: { readOnly: true } },
  ],
};
