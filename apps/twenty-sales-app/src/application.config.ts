import { defineApplication, FieldType } from 'twenty-sdk/define';

export const APPLICATION_UNIVERSAL_IDENTIFIER =
  '9c79ce05-e6b7-4aae-9049-08f0276c6dd2';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Watcher Sales CRM',
  description:
    'CRM metadata for Watcher sales research, qualification, referrals, and draft outreach.',
  applicationVariables: {
    WEB_DEVELOPMENT_REFERRAL_PERCENTAGE: {
      universalIdentifier: 'c1e02c31-e69b-4cb5-967b-6f392a4c8f39',
      label: 'Web-development referral percentage',
      description:
        'Percentage payable only after the first project has actually been paid.',
      type: FieldType.NUMBER,
      value: 10,
      isSecret: false,
    },
  },
});
