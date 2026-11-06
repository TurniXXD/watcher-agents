import { seoField, slugField, tagsField } from '../fields/editorial';
import { commonQuickFilters, publishableCollection } from './publishable';

export const articleManagedFields = [
  'title',
  'excerpt',
  'content',
  'author',
  'categories',
  'tags',
] as const;

export const Articles = publishableCollection({
  slug: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  useAsTitle: 'title',
  defaultColumns: [
    'title',
    'author',
    'publishAt',
    'reviewStatus',
    '_status',
    'updatedAt',
  ],
  trackPublishedAt: true,
  managedFields: articleManagedFields,
  previewPath: (doc) =>
    typeof doc.slug === 'string' ? `/articles/${doc.slug}` : null,
  quickFilters: commonQuickFilters([
    { label: 'Scheduled', where: { publishAt: { greater_than: '$now' } } },
  ]),
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 300 },
    slugField(),
    { name: 'excerpt', type: 'textarea', maxLength: 600 },
    { name: 'content', type: 'richText' },
    { name: 'coverImage', type: 'upload', relationTo: 'media' },
    { name: 'author', type: 'text', admin: { description: 'Public byline.' } },
    { name: 'categories', type: 'text', hasMany: true, maxRows: 10 },
    tagsField(),
    {
      name: 'publishAt',
      type: 'date',
      index: true,
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description:
          'Embargo: published content stays out of the public API until this time.',
      },
    },
    seoField,
  ],
});
