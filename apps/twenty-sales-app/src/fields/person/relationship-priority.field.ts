import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
export default defineField({
  universalIdentifier: 'ac200000-0000-4000-8000-000000000005',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  name: 'relationshipPriority',
  label: 'Relationship priority',
  type: FieldType.SELECT,
  isNullable: true,
  options: [
    { value: 'LOW', label: 'Low', position: 0, color: 'gray' },
    { value: 'MEDIUM', label: 'Medium', position: 1, color: 'yellow' },
    { value: 'HIGH', label: 'High', position: 2, color: 'red' },
  ],
});
