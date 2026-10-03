import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
export default defineField({
  universalIdentifier: 'ac300000-0000-4000-8000-000000000001',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.opportunity.universalIdentifier,
  name: 'businessType',
  label: 'Business type',
  type: FieldType.SELECT,
  isNullable: true,
  options: [
    {
      value: 'WEB_DEVELOPMENT',
      label: 'Web development',
      position: 0,
      color: 'blue',
    },
    {
      value: 'PROPERTY_MANAGEMENT',
      label: 'Property management',
      position: 1,
      color: 'green',
    },
    {
      value: 'OFFICE_CARE',
      label: 'Office care',
      position: 2,
      color: 'purple',
    },
    {
      value: 'EQUIPMENT_RENTAL',
      label: 'Equipment rental',
      position: 3,
      color: 'orange',
    },
    { value: 'OTHER', label: 'Other', position: 4, color: 'gray' },
  ],
});
