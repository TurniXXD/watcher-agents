import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_INCOMING_RELATIONSHIPS_FIELD_ID,
  RELATIONSHIP_TO_PERSON_FIELD_ID,
  SALES_RELATIONSHIP_OBJECT_ID,
} from '../../objects/identifiers.js';
export default defineField({
  universalIdentifier: PERSON_INCOMING_RELATIONSHIPS_FIELD_ID,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  name: 'incomingSalesRelationships',
  label: 'Incoming relationships',
  type: FieldType.RELATION,
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: SALES_RELATIONSHIP_OBJECT_ID,
  relationTargetFieldMetadataUniversalIdentifier:
    RELATIONSHIP_TO_PERSON_FIELD_ID,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
