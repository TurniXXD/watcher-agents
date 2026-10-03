import {
  defineIndex,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export default defineIndex({
  universalIdentifier: 'ac700000-0000-4000-8000-000000000003',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  isUnique: true,
  fields: [
    {
      universalIdentifier: 'ac700000-0000-4000-8000-000000000004',
      fieldUniversalIdentifier: 'ac200000-0000-4000-8000-000000000011',
    },
  ],
});
