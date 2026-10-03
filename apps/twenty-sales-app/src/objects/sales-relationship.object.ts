import {
  defineObject,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_INCOMING_RELATIONSHIPS_FIELD_ID,
  PERSON_OUTGOING_RELATIONSHIPS_FIELD_ID,
  RELATIONSHIP_FROM_PERSON_FIELD_ID,
  RELATIONSHIP_TO_PERSON_FIELD_ID,
  SALES_RELATIONSHIP_NAME_FIELD_ID,
  SALES_RELATIONSHIP_OBJECT_ID,
} from './identifiers.js';

export default defineObject({
  universalIdentifier: SALES_RELATIONSHIP_OBJECT_ID,
  nameSingular: 'salesRelationship',
  namePlural: 'salesRelationships',
  labelSingular: 'Relationship',
  labelPlural: 'Relationships',
  description: 'A deduplicated relationship between two CRM people.',
  icon: 'IconRelationManyToMany',
  isSearchable: true,
  labelIdentifierFieldMetadataUniversalIdentifier:
    SALES_RELATIONSHIP_NAME_FIELD_ID,
  fields: [
    {
      universalIdentifier: SALES_RELATIONSHIP_NAME_FIELD_ID,
      name: 'name',
      label: 'Name',
      type: FieldType.TEXT,
      isNullable: false,
      defaultValue: "''",
    },
    {
      universalIdentifier: RELATIONSHIP_FROM_PERSON_FIELD_ID,
      name: 'fromPerson',
      label: 'From person',
      type: FieldType.RELATION,
      isNullable: false,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        PERSON_OUTGOING_RELATIONSHIPS_FIELD_ID,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.CASCADE,
        joinColumnName: 'fromPersonId',
      },
    },
    {
      universalIdentifier: RELATIONSHIP_TO_PERSON_FIELD_ID,
      name: 'toPerson',
      label: 'To person',
      type: FieldType.RELATION,
      isNullable: false,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        PERSON_INCOMING_RELATIONSHIPS_FIELD_ID,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.CASCADE,
        joinColumnName: 'toPersonId',
      },
    },
    {
      universalIdentifier: 'ac400000-0000-4000-8000-000000000007',
      name: 'type',
      label: 'Type',
      type: FieldType.SELECT,
      isNullable: false,
      defaultValue: "'OTHER'",
      options: [
        'KNOWS',
        'FRIEND',
        'COLLEAGUE',
        'BUSINESS_PARTNER',
        'CLIENT',
        'SUPPLIER',
        'CONTRACTOR',
        'REFERRED',
        'INTRODUCED',
        'OTHER',
      ].map((value, position) => ({
        value,
        label: value.toLowerCase().replaceAll('_', ' '),
        position,
        color: 'gray' as const,
      })),
    },
    {
      universalIdentifier: 'ac400000-0000-4000-8000-000000000008',
      name: 'strength',
      label: 'Strength',
      type: FieldType.NUMBER,
      isNullable: true,
    },
    {
      universalIdentifier: 'ac400000-0000-4000-8000-000000000009',
      name: 'source',
      label: 'Source',
      type: FieldType.TEXT,
      isNullable: true,
    },
    {
      universalIdentifier: 'ac400000-0000-4000-8000-000000000010',
      name: 'notes',
      label: 'Notes',
      type: FieldType.RICH_TEXT,
      isNullable: true,
    },
  ],
});
