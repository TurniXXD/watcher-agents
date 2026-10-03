import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
export default defineField({
  universalIdentifier: 'ac200000-0000-4000-8000-000000000009',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  name: 'lastContactAt',
  label: 'Last contact at',
  type: FieldType.DATE_TIME,
  isNullable: true,
});
