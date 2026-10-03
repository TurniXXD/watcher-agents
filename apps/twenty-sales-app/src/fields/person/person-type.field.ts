import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
export default defineField({
  universalIdentifier: 'ac200000-0000-4000-8000-000000000001',
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  name: 'personType',
  label: 'Person type',
  type: FieldType.SELECT,
  isNullable: true,
  options: [
    { value: 'LEAD', label: 'Lead', position: 0, color: 'blue' },
    { value: 'CLIENT', label: 'Client', position: 1, color: 'green' },
    { value: 'PARTNER', label: 'Partner', position: 2, color: 'purple' },
    { value: 'SUPPLIER', label: 'Supplier', position: 3, color: 'orange' },
    { value: 'CONTRACTOR', label: 'Contractor', position: 4, color: 'yellow' },
    { value: 'INVESTOR', label: 'Investor', position: 5, color: 'gold' },
    { value: 'OTHER', label: 'Other', position: 6, color: 'gray' },
  ],
});
