import {
  defineIndex,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export default defineIndex({
  universalIdentifier: 'ac700000-0000-4000-8000-000000000001',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  isUnique: true,
  fields: [
    {
      universalIdentifier: 'ac700000-0000-4000-8000-000000000002',
      fieldUniversalIdentifier: 'ac100000-0000-4000-8000-000000000014',
    },
  ],
});
