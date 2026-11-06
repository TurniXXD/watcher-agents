import { statusOptions } from '../fields/editorial';
import { commonQuickFilters, publishableCollection } from './publishable';
import { asText } from '../lib/equality';

export const socialPlatforms = [
  'instagram',
  'linkedin',
  'tiktok',
  'youtube',
  'x',
] as const;
export const socialPostTypes = [
  'post',
  'carousel',
  'story',
  'reel',
  'short',
  'video',
] as const;
export const socialPublishingStatuses = [
  'draft',
  'scheduled',
  'published',
  'failed',
  'cancelled',
] as const;

/** Post formats each platform supports. */
export const platformPostTypes: Record<
  (typeof socialPlatforms)[number],
  readonly (typeof socialPostTypes)[number][]
> = {
  instagram: ['post', 'carousel', 'story', 'reel'],
  linkedin: ['post', 'carousel', 'video'],
  tiktok: ['video'],
  youtube: ['video', 'short'],
  x: ['post', 'video'],
};

export const socialPostManagedFields = [
  'title',
  'content',
  'platform',
  'postType',
  'hashtags',
  'targetUrl',
] as const;

export const SocialPosts = publishableCollection({
  slug: 'social-posts',
  labels: { singular: 'Social post', plural: 'Social Posts' },
  useAsTitle: 'title',
  description: 'Planning only: the CMS never publishes to social platforms.',
  defaultColumns: [
    'title',
    'platform',
    'postType',
    'scheduledFor',
    'publishingStatus',
    'reviewStatus',
  ],
  managedFields: socialPostManagedFields,
  quickFilters: commonQuickFilters([
    {
      label: 'Scheduled',
      where: { publishingStatus: { equals: 'scheduled' } },
    },
  ]),
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    { name: 'content', type: 'textarea', required: true, maxLength: 5000 },
    {
      type: 'row',
      fields: [
        {
          name: 'platform',
          type: 'select',
          required: true,
          index: true,
          options: statusOptions(socialPlatforms),
          admin: { width: '50%' },
        },
        {
          name: 'postType',
          type: 'select',
          required: true,
          options: statusOptions(socialPostTypes),
          admin: { width: '50%' },
          validate: (
            value: unknown,
            { siblingData }: { siblingData: Record<string, unknown> },
          ) => {
            const platform = siblingData.platform as
              keyof typeof platformPostTypes | undefined;
            if (!value) return 'Required';
            return !platform ||
              platformPostTypes[platform]?.includes(value as never)
              ? true
              : `${asText(value)} is not supported on ${platform}`;
          },
        },
      ],
    },
    {
      name: 'media',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
      maxRows: 20,
    },
    { name: 'hashtags', type: 'text', hasMany: true, maxRows: 30 },
    { name: 'targetUrl', type: 'text' },
    {
      name: 'scheduledFor',
      type: 'date',
      index: true,
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'publishingStatus',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: statusOptions(socialPublishingStatuses),
      admin: {
        description: 'Tracked manually; no platform publishing is implemented.',
      },
    },
    { name: 'externalPostId', type: 'text' },
    { name: 'externalPostUrl', type: 'text' },
    {
      name: 'relatedContent',
      type: 'relationship',
      relationTo: ['events', 'articles', 'news', 'publications'],
      hasMany: true,
    },
  ],
});
