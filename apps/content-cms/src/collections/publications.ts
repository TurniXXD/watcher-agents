import { slugField } from '../fields/editorial';
import { commonQuickFilters, publishableCollection } from './publishable';
import { asText } from '../lib/equality';

export const publicationManagedFields = [
  'title',
  'authors',
  'abstract',
  'aiSummary',
  'doi',
  'journal',
  'publicationDate',
  'publicationUrl',
  'researchTopics',
] as const;

export const Publications = publishableCollection({
  slug: 'publications',
  labels: { singular: 'Publication', plural: 'Publications' },
  useAsTitle: 'title',
  defaultColumns: [
    'title',
    'journal',
    'publicationDate',
    'reviewStatus',
    '_status',
  ],
  trackPublishedAt: true,
  managedFields: publicationManagedFields,
  previewPath: (doc) =>
    typeof doc.slug === 'string' ? `/publications/${doc.slug}` : null,
  quickFilters: commonQuickFilters([
    { label: 'Scheduled', where: { publishAt: { greater_than: '$now' } } },
  ]),
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 500 },
    slugField(),
    { name: 'authors', type: 'text', hasMany: true, maxRows: 200 },
    {
      name: 'abstract',
      type: 'textarea',
      admin: {
        description:
          'Publisher abstract for internal review. Only the AI summary is public.',
      },
    },
    {
      name: 'aiSummary',
      label: 'AI-generated summary',
      type: 'textarea',
      maxLength: 3000,
    },
    {
      name: 'doi',
      label: 'DOI',
      type: 'text',
      index: true,
      validate: (value: unknown) =>
        !value || /^10\.\d{4,9}\/\S+$/u.test(asText(value))
          ? true
          : 'Enter a DOI such as 10.1000/xyz123',
    },
    { name: 'journal', type: 'text' },
    { name: 'publicationDate', type: 'date', index: true },
    { name: 'publicationUrl', type: 'text' },
    { name: 'researchTopics', type: 'text', hasMany: true, maxRows: 30 },
    {
      name: 'publishAt',
      type: 'date',
      index: true,
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
  ],
});
