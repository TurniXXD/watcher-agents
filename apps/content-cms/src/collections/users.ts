import type {
  Access,
  CollectionBeforeChangeHook,
  CollectionConfig,
} from 'payload';
import { adminField, hasRole, roles } from '../access/roles';
import { statusOptions } from '../fields/editorial';

const adminOrSelf: Access = ({ req }) => {
  if (hasRole(req.user, 'admin')) return true;
  if (req.user?.collection === 'users') return { id: { equals: req.user.id } };
  return false;
};

/** The very first account becomes an administrator. */
const bootstrapFirstAdmin: CollectionBeforeChangeHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation === 'create') {
    const { totalDocs } = await req.payload.count({
      collection: 'users',
      req,
      overrideAccess: true,
    });
    if (totalDocs === 0) data.role = 'admin';
  }
  return data;
};

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'User', plural: 'Users' },
  auth: {
    tokenExpiration: 8 * 60 * 60,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: { sameSite: 'Lax', secure: process.env.NODE_ENV === 'production' },
  },
  access: {
    admin: ({ req }) => hasRole(req.user, ...roles),
    create: ({ req }) => hasRole(req.user, 'admin'),
    read: adminOrSelf,
    update: adminOrSelf,
    delete: ({ req }) => hasRole(req.user, 'admin'),
  },
  admin: {
    group: 'Administration',
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role'],
  },
  hooks: { beforeChange: [bootstrapFirstAdmin] },
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      saveToJWT: true,
      options: statusOptions(roles),
      access: { create: adminField, update: adminField },
      admin: {
        description:
          'Editor: edit content. Reviewer: also approve, reject, archive, and publish. Admin: also users, credentials, and settings.',
      },
    },
  ],
};
