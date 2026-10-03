import { defineIndex } from 'twenty-sdk/define';
import {
  RELATIONSHIP_FROM_PERSON_FIELD_ID,
  RELATIONSHIP_TO_PERSON_FIELD_ID,
  SALES_RELATIONSHIP_OBJECT_ID,
} from '../objects/identifiers.js';

export default defineIndex({
  universalIdentifier: 'ac700000-0000-4000-8000-000000000005',
  objectUniversalIdentifier: SALES_RELATIONSHIP_OBJECT_ID,
  isUnique: true,
  fields: [
    {
      universalIdentifier: 'ac700000-0000-4000-8000-000000000006',
      fieldUniversalIdentifier: RELATIONSHIP_FROM_PERSON_FIELD_ID,
    },
    {
      universalIdentifier: 'ac700000-0000-4000-8000-000000000007',
      fieldUniversalIdentifier: RELATIONSHIP_TO_PERSON_FIELD_ID,
    },
    {
      universalIdentifier: 'ac700000-0000-4000-8000-000000000008',
      fieldUniversalIdentifier: 'ac400000-0000-4000-8000-000000000007',
    },
  ],
});
