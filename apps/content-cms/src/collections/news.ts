import { slugField, tagsField } from '../fields/editorial';
import { commonQuickFilters, publishableCollection } from './publishable';

export const newsManagedFields = [
  'title',
  'summary',
  'body',
  'originalUrl',
  'publisher',
  'originalPublishedAt',
  'category',
  'tags',
] as const;

export const News = publishableCollection({
  slug: 'news',
  labels: { singular: 'News item', plural: 'News' },
  useAsTitle: 'title',
  defaultColumns: [
    'title',
    'publisher',
    'originalPublishedAt',
    'reviewStatus',
    '_status',
  ],
  trackPublishedAt: true,
  managedFields: newsManagedFields,
  previewPath: (doc) =>
    typeof doc.slug === 'string' ? `/news/${doc.slug}` : null,
  quickFilters: commonQuickFilters([
    { label: 'Scheduled', where: { publishAt: { greater_than: '$now' } } },
  ]),
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 300 },
    slugField(),
    {
      name: 'summary',
      type: 'textarea',
      maxLength: 1500,
      admin: { description: 'Original summary, not a copy of the article.' },
    },
    { name: 'body', type: 'richText' },
    { name: 'originalUrl', type: 'text', required: true },
    { name: 'publisher', type: 'text' },
    { name: 'originalPublishedAt', type: 'date', index: true },
    { name: 'category', type: 'text', index: true },
    tagsField(),
    {
      name: 'publishAt',
      type: 'date',
      index: true,
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
  ],
});
