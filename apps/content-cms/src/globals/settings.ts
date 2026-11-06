import type { GlobalConfig } from 'payload';
import { isAdmin, isStaff } from '../access/roles';

export const DEFAULT_CRITICAL_GRACE_HOURS = 48;

export const Settings: GlobalConfig = {
  slug: 'settings',
  label: 'Settings',
  access: { read: isStaff, update: isAdmin },
  admin: { group: 'Administration' },
  fields: [
    { name: 'siteName', type: 'text', defaultValue: 'Vantuch Content Hub' },
    {
      name: 'correctionsContactEmail',
      type: 'email',
      admin: {
        description:
          'Where organisers can request corrections or removal of listings (documented publicly).',
      },
    },
    {
      name: 'criticalUpdateGraceHours',
      type: 'number',
      min: 1,
      max: 720,
      defaultValue: DEFAULT_CRITICAL_GRACE_HOURS,
      admin: {
        description:
          'Published events with an unresolved conflicting date change are hidden from the public API after this many hours.',
      },
    },
  ],
};
