import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APIError,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type Where,
} from 'payload';
import { hasRole, isEditorial, roleOf, staffField } from '../access/roles';
import { loadEnv } from '../env';
import { statusOptions } from '../fields/editorial';

export const mediaUsageRights = [
  'owned',
  'licensed',
  'permission_granted',
  'public_domain',
  'creative_commons',
  'unknown',
  'not_permitted',
] as const;

/** Usage rights that allow public republication. `unknown` never qualifies. */
export const publishableUsageRights = [
  'owned',
  'licensed',
  'permission_granted',
  'public_domain',
  'creative_commons',
] as const;

export const publicMediaWhere: Where = {
  and: [
    { visibility: { equals: 'public' } },
    { usageRights: { in: [...publishableUsageRights] } },
  ],
};

export const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/webm',
] as const;

export const mediaKind = (
  mimeType: string,
): 'image' | 'video' | 'document' | null => {
  if (!(allowedMimeTypes as readonly string[]).includes(mimeType)) return null;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
};

export const maxBytesFor = (kind: 'image' | 'video' | 'document'): number => {
  const env = loadEnv();
  const megabytes =
    kind === 'image'
      ? env.MEDIA_MAX_IMAGE_SIZE_MB
      : kind === 'video'
        ? env.MEDIA_MAX_VIDEO_SIZE_MB
        : env.MEDIA_MAX_DOCUMENT_SIZE_MB;
  return Math.floor(megabytes * 1024 * 1024);
};

const enforceUploadPolicy: CollectionBeforeChangeHook = ({ data, req }) => {
  if (typeof data.mimeType === 'string') {
    const kind = mediaKind(data.mimeType);
    if (!kind)
      throw new APIError(
        `Unsupported file type ${data.mimeType}`,
        415,
        undefined,
        true,
      );
    if (
      typeof data.filesize === 'number' &&
      data.filesize > maxBytesFor(kind)
    ) {
      throw new APIError(
        `File exceeds the ${kind} size limit`,
        413,
        undefined,
        true,
      );
    }
    if (kind === 'image' && !data.alt) {
      throw new APIError(
        'Alt text is required for images',
        400,
        undefined,
        true,
      );
    }
  }
  if (
    data.visibility === 'public' &&
    !(publishableUsageRights as readonly string[]).includes(
      String(data.usageRights),
    )
  ) {
    throw new APIError(
      'Public media needs usage rights that permit publication',
      400,
      undefined,
      true,
    );
  }
  if (
    data.visibility === 'public' &&
    !hasRole(req.user, 'admin', 'reviewer') &&
    roleOf(req.user)
  ) {
    // Editors can upload but a reviewer confirms rights before media becomes public.
    data.visibility = 'private';
  }
  return data;
};

const readMedia: Access = ({ req }) =>
  roleOf(req.user) ? true : publicMediaWhere;

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Media item', plural: 'Media' },
  access: {
    read: readMedia,
    create: isEditorial,
    update: isEditorial,
    delete: ({ req }) => hasRole(req.user, 'admin', 'reviewer'),
  },
  admin: {
    group: 'Assets',
    useAsTitle: 'filename',
    defaultColumns: [
      'filename',
      'alt',
      'usageRights',
      'visibility',
      'updatedAt',
    ],
    description:
      'Files live in RustFS. Private items require a CMS login; public items need explicit usage rights.',
  },
  upload: {
    // Local fallback for development only; production stores files in RustFS.
    staticDir: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../media-local',
    ),
    mimeTypes: [...allowedMimeTypes],
    adminThumbnail: 'thumbnail',
    focalPoint: true,
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
      { name: 'card', width: 1024, withoutEnlargement: true },
      { name: 'hero', width: 1920, withoutEnlargement: true },
    ],
  },
  hooks: { beforeChange: [enforceUploadPolicy] },
  fields: [
    { name: 'alt', label: 'Alt text', type: 'text', maxLength: 300 },
    { name: 'caption', type: 'textarea', maxLength: 1000 },
    { name: 'credit', label: 'Copyright / credit', type: 'text' },
    {
      name: 'license',
      type: 'text',
      admin: { description: 'License name or URL, e.g. CC BY 4.0' },
    },
    {
      name: 'usageRights',
      type: 'select',
      required: true,
      defaultValue: 'unknown',
      options: statusOptions(mediaUsageRights),
      admin: { position: 'sidebar' },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      index: true,
      options: statusOptions(['private', 'public']),
      admin: { position: 'sidebar' },
    },
    { name: 'originalSourceUrl', type: 'text' },
    { name: 'internalNotes', type: 'textarea', access: { read: staffField } },
  ],
};
