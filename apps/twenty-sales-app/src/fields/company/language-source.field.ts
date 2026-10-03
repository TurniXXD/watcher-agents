import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
export default defineField({
  universalIdentifier: 'ac100000-0000-4000-8000-000000000005',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  name: 'languageDetectionSource',
  label: 'Language detection source',
  type: FieldType.TEXT,
  isNullable: true,
});
