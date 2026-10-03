import {
  defineObject,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  COMPANY_REFERRALS_FIELD_ID,
  OPPORTUNITY_REFERRALS_FIELD_ID,
  PERSON_RECEIVED_REFERRALS_FIELD_ID,
  PERSON_REFERRALS_FIELD_ID,
  REFERRAL_COMPANY_FIELD_ID,
  REFERRAL_OPPORTUNITY_FIELD_ID,
  REFERRAL_PERSON_FIELD_ID,
  REFERRAL_REFERRER_FIELD_ID,
  SALES_REFERRAL_NAME_FIELD_ID,
  SALES_REFERRAL_OBJECT_ID,
} from './identifiers.js';

export default defineObject({
  universalIdentifier: SALES_REFERRAL_OBJECT_ID,
  nameSingular: 'salesReferral',
  namePlural: 'salesReferrals',
  labelSingular: 'Referral',
  labelPlural: 'Referrals',
  description:
    'Referral tracking; commission becomes payable only after actual payment.',
  icon: 'IconAffiliate',
  isSearchable: true,
  labelIdentifierFieldMetadataUniversalIdentifier: SALES_REFERRAL_NAME_FIELD_ID,
  fields: [
    {
      universalIdentifier: SALES_REFERRAL_NAME_FIELD_ID,
      name: 'name',
      label: 'Name',
      type: FieldType.TEXT,
      isNullable: false,
      defaultValue: "''",
    },
    {
      universalIdentifier: REFERRAL_REFERRER_FIELD_ID,
      name: 'referrer',
      label: 'Referrer',
      type: FieldType.RELATION,
      isNullable: false,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier: PERSON_REFERRALS_FIELD_ID,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.RESTRICT,
        joinColumnName: 'referrerId',
      },
    },
    {
      universalIdentifier: REFERRAL_PERSON_FIELD_ID,
      name: 'referredPerson',
      label: 'Referred person',
      type: FieldType.RELATION,
      isNullable: true,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        PERSON_RECEIVED_REFERRALS_FIELD_ID,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.SET_NULL,
        joinColumnName: 'referredPersonId',
      },
    },
    {
      universalIdentifier: REFERRAL_COMPANY_FIELD_ID,
      name: 'referredCompany',
      label: 'Referred company',
      type: FieldType.RELATION,
      isNullable: true,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        COMPANY_REFERRALS_FIELD_ID,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.SET_NULL,
        joinColumnName: 'referredCompanyId',
      },
    },
    {
      universalIdentifier: REFERRAL_OPPORTUNITY_FIELD_ID,
      name: 'opportunity',
      label: 'Opportunity',
      type: FieldType.RELATION,
      isNullable: true,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.opportunity.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        OPPORTUNITY_REFERRALS_FIELD_ID,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.SET_NULL,
        joinColumnName: 'opportunityId',
      },
    },
    {
      universalIdentifier: 'ac500000-0000-4000-8000-000000000011',
      name: 'commissionType',
      label: 'Commission type',
      type: FieldType.SELECT,
      isNullable: false,
      defaultValue: "'PERCENTAGE'",
      options: [
        {
          value: 'PERCENTAGE',
          label: 'Percentage',
          position: 0,
          color: 'blue',
        },
        { value: 'FIXED', label: 'Fixed', position: 1, color: 'green' },
      ],
    },
    {
      universalIdentifier: 'ac500000-0000-4000-8000-000000000012',
      name: 'commissionPercentage',
      label: 'Commission percentage',
      type: FieldType.NUMBER,
      isNullable: true,
    },
    {
      universalIdentifier: 'ac500000-0000-4000-8000-000000000013',
      name: 'commissionAmount',
      label: 'Commission amount',
      type: FieldType.CURRENCY,
      isNullable: true,
    },
    {
      universalIdentifier: 'ac500000-0000-4000-8000-000000000014',
      name: 'status',
      label: 'Status',
      type: FieldType.SELECT,
      isNullable: false,
      defaultValue: "'PENDING'",
      options: [
        'PENDING',
        'QUALIFIED',
        'WON',
        'AWAITING_PAYMENT',
        'PAYABLE',
        'PAID',
        'CANCELLED',
      ].map((value, position) => ({
        value,
        label: value.toLowerCase().replaceAll('_', ' '),
        position,
        color: 'gray' as const,
      })),
    },
    {
      universalIdentifier: 'ac500000-0000-4000-8000-000000000015',
      name: 'payableAt',
      label: 'Payable at',
      type: FieldType.DATE_TIME,
      isNullable: true,
    },
    {
      universalIdentifier: 'ac500000-0000-4000-8000-000000000016',
      name: 'paidAt',
      label: 'Paid at',
      type: FieldType.DATE_TIME,
      isNullable: true,
    },
  ],
});
