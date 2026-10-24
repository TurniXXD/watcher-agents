import { defineApplication, FieldType } from 'twenty-sdk/define';

export const APPLICATION_UNIVERSAL_IDENTIFIER =
  '9c79ce05-e6b7-4aae-9049-08f0276c6dd2';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Watcher Sales CRM',
  description:
    'CRM metadata for Watcher sales research, qualification, referrals, and draft outreach.',
  applicationVariables: {
    SALES_INBOUND_WEBHOOK_URL: {
      universalIdentifier: '08e25621-a4e2-4ab8-91ce-3c9ff014b8c1',
      label: 'Sales inbound webhook URL',
      description:
        'Internal Sales Bot endpoint receiving idempotent inbound-lead events.',
      type: FieldType.TEXT,
      value: 'http://sales-bot:4050/v1/webhooks/twenty/inbound-lead',
      isSecret: false,
      isRequired: true,
    },
    SALES_INBOUND_WEBHOOK_TOKEN: {
      universalIdentifier: '571fcfd6-698d-4125-922c-219986c3b3c5',
      label: 'Sales inbound webhook token',
      description:
        'Bearer token shared with the Sales Bot SALES_WEBHOOK_TOKEN.',
      type: FieldType.TEXT,
      isSecret: true,
      isRequired: true,
    },
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
