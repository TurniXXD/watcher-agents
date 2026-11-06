import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload';
import { isAdmin, isEditorial, isStaff } from '../access/roles';
import { statusOptions } from '../fields/editorial';
import { invalidateBlockedDomains } from '../ingestion/blocklist';

export const sourceUsageRights = [
  'facts_only',
  'licensed',
  'permission_granted',
  'open_license',
  'unknown',
  'do_not_use',
] as const;

export const hostnameOf = (value: string): string | null => {
  try {
    return new URL(value).hostname.replace(/^www\./u, '').toLowerCase();
  } catch {
    return null;
  }
};

const deriveDomain: CollectionBeforeChangeHook = ({ data }) => {
  if (typeof data.url === 'string') data.domain = hostnameOf(data.url);
  return data;
};

export const Sources: CollectionConfig = {
  slug: 'sources',
  labels: { singular: 'Source', plural: 'Sources' },
  access: {
    read: isStaff,
    create: isEditorial,
    update: isEditorial,
    delete: isAdmin,
  },
  admin: {
    group: 'Assets',
    useAsTitle: 'title',
    defaultColumns: [
      'title',
      'domain',
      'sourceType',
      'usageRights',
      'ingestionBlocked',
      'lastCheckedAt',
    ],
    description:
      'Provenance register. Block a domain here to honour a removal request: ingestion then skips its items.',
  },
  hooks: {
    beforeChange: [deriveDomain],
    afterChange: [
      ({ doc }: { doc: unknown }) => {
        invalidateBlockedDomains();
        return doc;
      },
    ],
    afterDelete: [
      ({ doc }: { doc: unknown }) => {
        invalidateBlockedDomains();
        return doc;
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'url', type: 'text', required: true, unique: true },
    { name: 'domain', type: 'text', index: true, admin: { readOnly: true } },
    {
      name: 'sourceType',
      type: 'select',
      required: true,
      defaultValue: 'website',
      options: statusOptions([
        'website',
        'rss',
        'api',
        'ical',
        'social',
        'other',
      ]),
    },
    { name: 'publisher', type: 'text' },
    { name: 'discoveredAt', type: 'date' },
    { name: 'lastCheckedAt', type: 'date' },
    {
      name: 'usageRights',
      type: 'select',
      required: true,
      defaultValue: 'facts_only',
      options: statusOptions(sourceUsageRights),
    },
    {
      name: 'ingestionBlocked',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description:
          'Skip all future bot items whose source URL is on this domain.',
      },
    },
    { name: 'notes', type: 'textarea' },
  ],
};
