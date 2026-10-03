import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
export default defineField({
  universalIdentifier: 'ac100000-0000-4000-8000-000000000012',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  name: 'enrichmentStatus',
  label: 'Enrichment status',
  type: FieldType.SELECT,
  isNullable: true,
  options: [
    { value: 'PENDING', label: 'Pending', position: 0, color: 'gray' },
    { value: 'RESEARCHED', label: 'Researched', position: 1, color: 'blue' },
    { value: 'FAILED', label: 'Failed', position: 2, color: 'red' },
  ],
});
