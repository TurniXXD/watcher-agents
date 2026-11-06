import type { CollectionConfig } from 'payload';
import { isAdmin, isStaff, nobody } from '../access/roles';
import { statusOptions } from '../fields/editorial';

export const ingestibleCollections = [
  'events',
  'articles',
  'news',
  'publications',
  'social-posts',
] as const;
export type IngestibleCollection = (typeof ingestibleCollections)[number];

export const IngestionClients: CollectionConfig = {
  slug: 'ingestion-clients',
  labels: { singular: 'Bot credential', plural: 'Bot Credentials' },
  access: { read: isAdmin, create: nobody, update: isAdmin, delete: isAdmin },
  admin: {
    group: 'Administration',
    useAsTitle: 'name',
    defaultColumns: [
      'name',
      'botId',
      'keyId',
      'scopes',
      'active',
      'expiresAt',
      'lastUsedAt',
    ],
    description:
      'Machine credentials for bots. Create one below (or with `pnpm credentials:create`); the token is shown once and only its hash is stored. Rotate by creating a new credential and deactivating the old one.',
    components: {
      beforeListTable: ['/components/CreateCredential#CreateCredential'],
    },
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'botId',
      type: 'text',
      required: true,
      index: true,
      validate: (value: unknown) =>
        typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/u.test(value)
          ? true
          : 'Lowercase id',
    },
    {
      name: 'keyId',
      type: 'text',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    { name: 'secretHash', type: 'text', required: true, hidden: true },
    {
      name: 'scopes',
      type: 'select',
      hasMany: true,
      required: true,
      options: statusOptions(ingestibleCollections),
      admin: {
        description:
          'Collections this bot may ingest into. Bots can never publish.',
      },
    },
    { name: 'active', type: 'checkbox', defaultValue: true, index: true },
    { name: 'expiresAt', type: 'date' },
    { name: 'lastUsedAt', type: 'date', admin: { readOnly: true } },
    { name: 'notes', type: 'textarea' },
  ],
};

export const IngestionRuns: CollectionConfig = {
  slug: 'ingestion-runs',
  labels: { singular: 'Ingestion run', plural: 'Ingestion Runs' },
  access: { read: isStaff, create: nobody, update: nobody, delete: isAdmin },
  admin: {
    group: 'Operations',
    useAsTitle: 'id',
    defaultColumns: [
      'botId',
      'targetCollection',
      'status',
      'received',
      'created',
      'updated',
      'proposed',
      'skipped',
      'failed',
      'startedAt',
    ],
  },
  defaultSort: '-startedAt',
  indexes: [{ fields: ['botId', 'idempotencyKey'], unique: true }],
  fields: [
    { name: 'botId', type: 'text', required: true, index: true },
    { name: 'credentialKeyId', type: 'text' },
    {
      name: 'targetCollection',
      type: 'select',
      required: true,
      options: statusOptions(ingestibleCollections),
    },
    { name: 'idempotencyKey', type: 'text' },
    { name: 'requestId', type: 'text' },
    { name: 'startedAt', type: 'date', required: true, index: true },
    { name: 'completedAt', type: 'date' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'running',
      index: true,
      options: statusOptions(['running', 'succeeded', 'partial', 'failed']),
    },
    {
      type: 'row',
      fields: [
        { name: 'received', type: 'number', defaultValue: 0 },
        { name: 'created', type: 'number', defaultValue: 0 },
        { name: 'updated', type: 'number', defaultValue: 0 },
        { name: 'proposed', type: 'number', defaultValue: 0 },
        { name: 'skipped', type: 'number', defaultValue: 0 },
        { name: 'failed', type: 'number', defaultValue: 0 },
      ],
    },
    {
      name: 'results',
      type: 'json',
      admin: { description: 'Per-item outcome.' },
    },
    { name: 'errors', type: 'json' },
  ],
};

export const IngestionRecords: CollectionConfig = {
  slug: 'ingestion-records',
  labels: { singular: 'Bot snapshot', plural: 'Bot Snapshots' },
  access: { read: isStaff, create: nobody, update: nobody, delete: isAdmin },
  admin: {
    group: 'Operations',
    useAsTitle: 'identity',
    defaultColumns: [
      'identity',
      'targetCollection',
      'sourceBot',
      'lastSeenAt',
      'lastChangedAt',
    ],
    description:
      'Latest raw bot output per source identity. Editorial content lives in the content collections.',
  },
  fields: [
    {
      name: 'identity',
      type: 'text',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: 'targetCollection',
      type: 'select',
      required: true,
      index: true,
      options: statusOptions(ingestibleCollections),
    },
    { name: 'targetId', type: 'text', required: true, index: true },
    { name: 'sourceBot', type: 'text', required: true, index: true },
    { name: 'externalId', type: 'text', required: true },
    { name: 'snapshot', type: 'json', required: true },
    { name: 'snapshotHash', type: 'text', required: true },
    { name: 'firstSeenAt', type: 'date', required: true },
    { name: 'lastSeenAt', type: 'date', required: true, index: true },
    { name: 'lastChangedAt', type: 'date', required: true },
    { name: 'lastRun', type: 'relationship', relationTo: 'ingestion-runs' },
  ],
};
