import { z } from 'zod';
import { supportedLanguages } from '../../classification/index.js';

export const coldEmailOutputSchema = z
  .object({
    language: z.enum(supportedLanguages),
    subject: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(2_000),
    personalizationReason: z.string().trim().min(1).max(500),
    personalizationFact: z.string().trim().min(1).max(1_000).nullable(),
    confidence: z.number().min(0).max(1),
    insufficientPersonalizationData: z.boolean(),
  })
  .strict();

export const coldEmailJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'language',
    'subject',
    'body',
    'personalizationReason',
    'personalizationFact',
    'confidence',
    'insufficientPersonalizationData',
  ],
  properties: {
    language: { enum: supportedLanguages },
    subject: { type: 'string', minLength: 1, maxLength: 160 },
    body: { type: 'string', minLength: 1, maxLength: 2_000 },
    personalizationReason: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
    },
    personalizationFact: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 1_000 },
        { type: 'null' },
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    insufficientPersonalizationData: { type: 'boolean' },
  },
} as const;
