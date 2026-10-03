import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_OUTGOING_RELATIONSHIPS_FIELD_ID,
  RELATIONSHIP_FROM_PERSON_FIELD_ID,
  SALES_RELATIONSHIP_OBJECT_ID,
} from '../../objects/identifiers.js';
export default defineField({
  universalIdentifier: PERSON_OUTGOING_RELATIONSHIPS_FIELD_ID,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  name: 'outgoingSalesRelationships',
  label: 'Outgoing relationships',
  type: FieldType.RELATION,
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: SALES_RELATIONSHIP_OBJECT_ID,
  relationTargetFieldMetadataUniversalIdentifier:
    RELATIONSHIP_FROM_PERSON_FIELD_ID,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
