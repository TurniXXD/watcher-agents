import type { CollectionBeforeChangeHook } from 'payload';
import { staffField } from '../access/roles';
import {
  seoField,
  slugField,
  statusOptions,
  tagsField,
} from '../fields/editorial';
import { slugify } from '../lib/slug';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '../lib/time';
import { commonQuickFilters, publishableCollection } from './publishable';
import { asText } from '../lib/equality';

export const eventStatuses = ['scheduled', 'cancelled', 'postponed'] as const;
export const freeFoodValues = ['yes', 'no', 'unknown'] as const;

/** Fields a bot may provide. Human changes to these are never overwritten. */
export const eventManagedFields = [
  'title',
  'summary',
  'description',
  'startsAt',
  'endsAt',
  'timezone',
  'city',
  'venueName',
  'address',
  'category',
  'tags',
  'organizerName',
  'sourceUrl',
  'registrationUrl',
  'isFree',
  'price',
  'currency',
  'freeFood',
  'foodDetails',
  'eventStatus',
] as const;

const normalizeEvent: CollectionBeforeChangeHook = ({ data }) => {
  if (typeof data.city === 'string') {
    const city = asText(data.city).trim();
    data.city = city;
    data.citySlug = slugify(city);
  }
  if (typeof data.category === 'string')
    data.category = slugify(data.category) || 'other';
  if (typeof data.currency === 'string')
    data.currency = data.currency.trim().toUpperCase() || null;
  if (Array.isArray(data.tags)) {
    data.tags = [
      ...new Set(
        (data.tags as unknown[])
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
  }
  if (data.isFree === true && (data.price === undefined || data.price === null))
    data.price = 0;
  return data;
};

const httpUrl = (value: unknown, { required = false } = {}) => {
  if (value === null || value === undefined || value === '')
    return required ? 'Required' : true;
  try {
    const url = new URL(asText(value));
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? true
      : 'Use an http(s) URL';
  } catch {
    return 'Enter a valid URL';
  }
};

export const Events = publishableCollection({
  slug: 'events',
  labels: { singular: 'Event', plural: 'Events' },
  useAsTitle: 'title',
  description:
    'Factual event listings with source attribution. Write original summaries; do not paste organiser descriptions.',
  defaultColumns: [
    'title',
    'startsAt',
    'city',
    'category',
    'eventStatus',
    'freeFood',
    'reviewStatus',
    '_status',
  ],
  managedFields: eventManagedFields,
  previewPath: (doc) =>
    typeof doc.slug === 'string' ? `/events/${doc.slug}` : null,
  quickFilters: commonQuickFilters([
    { label: 'Upcoming', where: { startsAt: { greater_than_equal: '$now' } } },
    { label: 'Featured', where: { featured: { equals: true } } },
    { label: 'Free food', where: { freeFood: { equals: 'yes' } } },
    { label: 'Free admission', where: { isFree: { equals: true } } },
    { label: 'Cancelled', where: { eventStatus: { equals: 'cancelled' } } },
    {
      label: 'Critical updates',
      where: { criticalUpdatePendingSince: { exists: true } },
    },
  ]),
  indexes: [
    { fields: ['citySlug', 'startsAt'] },
    { fields: ['category', 'startsAt'] },
    { fields: ['reviewStatus', 'startsAt'] },
  ],
  hooks: { beforeChange: [normalizeEvent] },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 300 },
    slugField(),
    {
      name: 'summary',
      type: 'textarea',
      maxLength: 1000,
      admin: { description: 'Short original summary shown in listings.' },
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description: 'Editorial description. Rendered publicly as plain text.',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'startsAt',
          type: 'date',
          required: true,
          index: true,
          admin: { date: { pickerAppearance: 'dayAndTime' }, width: '33%' },
        },
        {
          name: 'endsAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, width: '33%' },
          validate: (
            value: unknown,
            { siblingData }: { siblingData: Record<string, unknown> },
          ) =>
            !value ||
            !siblingData.startsAt ||
            new Date(asText(value)) >= new Date(asText(siblingData.startsAt))
              ? true
              : 'End must not be before start',
        },
        {
          name: 'timezone',
          type: 'text',
          required: true,
          defaultValue: DEFAULT_TIME_ZONE,
          admin: {
            width: '33%',
            description: 'IANA time zone, e.g. Europe/Prague',
          },
          validate: (value: unknown) =>
            typeof value === 'string' && isValidTimeZone(value)
              ? true
              : 'Unknown IANA time zone',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'city',
          type: 'text',
          required: true,
          defaultValue: 'Brno',
          admin: { width: '33%' },
        },
        { name: 'venueName', type: 'text', admin: { width: '33%' } },
        { name: 'address', type: 'text', admin: { width: '33%' } },
      ],
    },
    {
      name: 'citySlug',
      type: 'text',
      index: true,
      access: { read: staffField },
      admin: { hidden: true },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'category',
          type: 'text',
          required: true,
          defaultValue: 'other',
          index: true,
          admin: {
            width: '50%',
            description: 'Lowercase slug, e.g. ai, workshop, music',
          },
        },
        tagsField('50%'),
      ],
    },
    { name: 'organizerName', type: 'text' },
    {
      type: 'row',
      fields: [
        {
          name: 'sourceUrl',
          type: 'text',
          required: true,
          admin: {
            width: '50%',
            description: 'Original organiser or source page (attribution).',
          },
          validate: (value: unknown) => httpUrl(value, { required: true }),
        },
        {
          name: 'registrationUrl',
          type: 'text',
          admin: { width: '50%' },
          validate: (value: unknown) => httpUrl(value),
        },
      ],
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Only exposed publicly when the media item is public and its usage rights permit publication.',
      },
    },
    {
      name: 'sourceImageUrl',
      type: 'text',
      access: { read: staffField },
      admin: {
        readOnly: true,
        description:
          'Image found at the source. Never republished automatically; obtain permission first.',
      },
    },
    {
      type: 'collapsible',
      label: 'Admission & food',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'isFree',
              label: 'Free admission',
              type: 'checkbox',
              admin: { width: '33%', description: 'Unset means unknown.' },
            },
            { name: 'price', type: 'number', min: 0, admin: { width: '33%' } },
            {
              name: 'currency',
              type: 'text',
              admin: { width: '33%' },
              validate: (value: unknown) =>
                !value || /^[A-Z]{3}$/u.test(asText(value).toUpperCase())
                  ? true
                  : 'Use an ISO 4217 code',
            },
          ],
        },
        {
          name: 'freeFood',
          type: 'select',
          required: true,
          defaultValue: 'unknown',
          index: true,
          options: statusOptions(freeFoodValues),
          admin: {
            description:
              'Yes only when a credible source explicitly confirms free food or refreshments. Free admission alone is not evidence.',
          },
        },
        { name: 'foodDetails', type: 'text', maxLength: 300 },
        {
          name: 'foodEvidence',
          type: 'json',
          access: { read: staffField },
          admin: {
            readOnly: true,
            description:
              'Source snippets supporting the free-food classification.',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'eventStatus',
          type: 'select',
          required: true,
          defaultValue: 'scheduled',
          index: true,
          options: statusOptions(eventStatuses),
          admin: { width: '33%' },
        },
        {
          name: 'featured',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          admin: { width: '33%' },
        },
        {
          name: 'lastVerifiedAt',
          type: 'date',
          admin: { width: '33%', readOnly: true },
        },
      ],
    },
    {
      name: 'criticalUpdatePendingSince',
      type: 'date',
      index: true,
      access: { read: staffField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'A bot reported a date change that conflicts with human edits. Unresolved events leave public listings after the grace period in Settings.',
      },
    },
    {
      name: 'sourceExcerpt',
      type: 'textarea',
      access: { read: staffField },
      admin: {
        readOnly: true,
        description: 'Internal context from the source. Never published.',
      },
    },
    seoField,
  ],
});
