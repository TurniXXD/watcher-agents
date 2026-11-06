import type {
  CollectionBeforeChangeHook,
  CollectionConfig,
  Field,
} from 'payload';
import { isAdmin, isEditorial, isStaff } from '../access/roles';
import {
  aiProvenanceField,
  ingestionSidebarFields,
  reviewStatusField,
  sourceReferencesField,
} from '../fields/editorial';
import {
  enforceEditorialWorkflow,
  revalidateAfterChange,
  revalidateAfterDelete,
  syncLiveReviewState,
  trackHumanEdits,
} from '../hooks/editorial';
import type { QuickFilter } from '../components/QuickFilters';
import { websitePreviewUrl } from '../lib/preview';

type PublishableOptions = {
  slug: CollectionConfig['slug'];
  labels: { singular: string; plural: string };
  useAsTitle: string;
  defaultColumns: string[];
  fields: Field[];
  /** Fields bots provide; human changes to them are tracked and protected. */
  managedFields: readonly string[];
  quickFilters?: QuickFilter[];
  description?: string;
  hooks?: CollectionConfig['hooks'];
  indexes?: CollectionConfig['indexes'];
  previewPath?: (doc: Record<string, unknown>) => string | null;
  /** Adds a read-only `publishedAt` stamped on first publication (respects `publishAt`). */
  trackPublishedAt?: boolean;
};

const publishedAtField: Field = {
  name: 'publishedAt',
  type: 'date',
  index: true,
  admin: {
    position: 'sidebar',
    readOnly: true,
    description: 'Set automatically on first publication.',
  },
};

type PublicationDates = {
  id: string;
  _status?: string | null;
  publishAt?: string | null;
  publishedAt?: string | null;
};

const stampPublishedAt: CollectionBeforeChangeHook<PublicationDates> = ({
  data,
  originalDoc,
}) => {
  if (
    data._status === 'published' &&
    !originalDoc?.publishedAt &&
    !data.publishedAt
  ) {
    data.publishedAt =
      data.publishAt ?? originalDoc?.publishAt ?? new Date().toISOString();
  }
  return data;
};

export const commonQuickFilters = (
  extra: QuickFilter[] = [],
): QuickFilter[] => [
  {
    label: 'Needs Review',
    where: { reviewStatus: { equals: 'needs_review' } },
  },
  { label: 'Ingested', where: { reviewStatus: { equals: 'ingested' } } },
  { label: 'Approved', where: { reviewStatus: { equals: 'approved' } } },
  { label: 'Published', where: { _status: { equals: 'published' } } },
  { label: 'Rejected', where: { reviewStatus: { equals: 'rejected' } } },
  { label: 'Archived', where: { reviewStatus: { equals: 'archived' } } },
  { label: 'Pending Updates', where: { hasPendingUpdates: { equals: true } } },
  { label: 'From bots', where: { sourceBot: { exists: true } } },
  ...extra,
];

export const publishableCollection = (
  options: PublishableOptions,
): CollectionConfig => ({
  slug: options.slug,
  labels: options.labels,
  access: {
    read: isStaff,
    readVersions: isStaff,
    create: isEditorial,
    update: isEditorial,
    delete: isAdmin,
  },
  admin: {
    group: 'Content',
    useAsTitle: options.useAsTitle,
    defaultColumns: options.defaultColumns,
    listSearchableFields: [options.useAsTitle, 'slug'],
    ...(options.description ? { description: options.description } : {}),
    pagination: { defaultLimit: 50 },
    components: {
      beforeListTable: [
        {
          path: '/components/QuickFilters#QuickFilters',
          clientProps: {
            collection: options.slug,
            filters: options.quickFilters ?? commonQuickFilters(),
          },
        },
      ],
    },
    ...(options.previewPath
      ? {
          preview: (doc: Record<string, unknown>) =>
            websitePreviewUrl(options.previewPath?.(doc) ?? null),
        }
      : {}),
  },
  defaultSort: '-updatedAt',
  versions: {
    maxPerDoc: 50,
    drafts: { schedulePublish: true },
  },
  ...(options.indexes ? { indexes: options.indexes } : {}),
  hooks: {
    ...options.hooks,
    beforeChange: [
      ...(options.hooks?.beforeChange ?? []),
      ...(options.trackPublishedAt ? [stampPublishedAt] : []),
      trackHumanEdits(options.managedFields),
      enforceEditorialWorkflow,
    ],
    afterChange: [
      ...(options.hooks?.afterChange ?? []),
      syncLiveReviewState,
      revalidateAfterChange,
    ],
    afterDelete: [...(options.hooks?.afterDelete ?? []), revalidateAfterDelete],
  },
  fields: [
    ...options.fields,
    reviewStatusField,
    ...(options.trackPublishedAt ? [publishedAtField] : []),
    ...ingestionSidebarFields,
    sourceReferencesField,
    aiProvenanceField,
  ],
});
