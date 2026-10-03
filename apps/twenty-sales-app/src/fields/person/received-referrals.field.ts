import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  PERSON_RECEIVED_REFERRALS_FIELD_ID,
  REFERRAL_PERSON_FIELD_ID,
  SALES_REFERRAL_OBJECT_ID,
} from '../../objects/identifiers.js';
export default defineField({
  universalIdentifier: PERSON_RECEIVED_REFERRALS_FIELD_ID,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  name: 'receivedSalesReferrals',
  label: 'Received referrals',
  type: FieldType.RELATION,
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: SALES_REFERRAL_OBJECT_ID,
  relationTargetFieldMetadataUniversalIdentifier: REFERRAL_PERSON_FIELD_ID,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
