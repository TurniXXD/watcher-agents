import type { OllamaProvider } from '@watcher/llm';
import { z } from 'zod';
import { lexicalNetworkSearch } from './search.js';
import {
  networkContactInputSchema,
  type NetworkContact,
  type NetworkContactInput,
  type NetworkContactPatch,
  type NetworkMatch,
  type NetworkSearchService,
} from './types.js';

type StructuredGenerator = Pick<OllamaProvider, 'generateStructured'>;

const optionalString = z
  .string()
  .trim()
  .max(4_000)
  .nullish()
  .transform((value) => value || undefined);

const draftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  metDate: optionalString,
  metAt: optionalString,
  phone: optionalString,
  email: optionalString,
  web: optionalString,
  socialNetwork: optionalString,
  meetingNote: optionalString,
  contactType: optionalString,
  followUp: optionalString,
  active: z.boolean().default(true),
});

const draftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'metDate',
    'metAt',
    'phone',
    'email',
    'web',
    'socialNetwork',
    'meetingNote',
    'contactType',
    'followUp',
    'active',
  ],
  properties: {
    name: { type: 'string' },
    metDate: { type: ['string', 'null'] },
    metAt: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    web: { type: ['string', 'null'] },
    socialNetwork: { type: ['string', 'null'] },
    meetingNote: { type: ['string', 'null'] },
    contactType: { type: ['string', 'null'] },
    followUp: { type: ['string', 'null'] },
    active: { type: 'boolean' },
  },
} as const;

const rankedMatchesSchema = z.object({
  matches: z
    .array(
      z.object({
        id: z.string(),
        quality: z.enum(['excellent', 'good', 'possible']),
        reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(4),
      }),
    )
    .max(5),
});

const rankedMatchesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'quality', 'reasons'],
        properties: {
          id: { type: 'string' },
          quality: { type: 'string', enum: ['excellent', 'good', 'possible'] },
          reasons: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

const updateSchema = z.object({
  field: z.enum([
    'name',
    'metDate',
    'metAt',
    'phone',
    'email',
    'web',
    'socialNetwork',
    'meetingNote',
    'contactType',
    'followUp',
    'active',
  ]),
  value: z.union([z.string().max(4_000), z.boolean()]),
});

const updateJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'value'],
  properties: {
    field: {
      type: 'string',
      enum: [
        'name',
        'metDate',
        'metAt',
        'phone',
        'email',
        'web',
        'socialNetwork',
        'meetingNote',
        'contactType',
        'followUp',
        'active',
      ],
    },
    value: { type: ['string', 'boolean'] },
  },
} as const;

const compactContact = (contact: NetworkContact) => ({
  id: contact.id,
  name: contact.name,
  metDate: contact.metDate ?? null,
  metAt: contact.metAt ?? null,
  phone: contact.phone ?? null,
  email: contact.email ?? null,
  web: contact.web ?? null,
  socialNetwork: contact.socialNetwork ?? null,
  meetingNote: contact.meetingNote ?? null,
  contactType: contact.contactType ?? null,
  followUp: contact.followUp ?? null,
  active: contact.active,
});

export class NetworkAiService implements NetworkSearchService {
  public constructor(private readonly generator?: StructuredGenerator) {}

  public async parseContact(
    description: string,
    today: string,
  ): Promise<NetworkContactInput> {
    if (!this.generator) {
      const name = description
        .replace(
          /^(?:přidej|pridej|add)(?:\s+(?:do|to))?\s+(?:networku|network)?\s*/iu,
          '',
        )
        .split(/[,.;]|\s+(?:dělá|dela|works|potkali|met)\b/iu)[0]
        ?.trim();
      if (!name) throw new Error('Chybí jméno kontaktu.');
      return networkContactInputSchema.parse({
        name,
        meetingNote: description,
        active: true,
      });
    }
    const result = await this.generator.generateStructured(
      `You extract a professional contact from Czech or English user text into the exact eleven-column Google Sheet model. Today is ${today}. Resolve relative dates such as dnes/yesterday to ISO YYYY-MM-DD. Preserve the complete original context in meetingNote. Put phone, email, website and a LinkedIn or other social profile into their dedicated fields. Put company and role into meetingNote and use role or relationship category for contactType when supported. Never invent facts. Unknown values must be null. "Domluvena další schůzka" may contain a date or short follow-up text. Return only sourced or safely date-resolved facts.\n\nUSER TEXT:\n${description}`,
      draftJsonSchema,
      draftSchema,
      undefined,
      {
        maxAttempts: 2,
        numPredict: 600,
        temperature: 0.1,
        diagnosticLabel: 'network-contact-extraction-v1',
      },
    );
    return networkContactInputSchema.parse(result);
  }

  public async search(
    query: string,
    contacts: NetworkContact[],
  ): Promise<NetworkMatch[]> {
    if (!this.generator || contacts.length === 0)
      return lexicalNetworkSearch(query, contacts);
    const candidates = contacts.slice(0, 250);
    const output = await this.generator.generateStructured(
      `Rank the most relevant people for the user's Czech or English professional-network query. Expertise and ability to help are primary. Location matters only when requested. Relationship activity is a weak tie-breaker and must never override expertise. Infer semantic similarity (e.g. získávání zákazníků may match B2B sales or lead generation), but use only the supplied records. Return at most five IDs, honest quality labels, and short Czech reasons grounded in specific record text.\n\nQUERY:\n${query}\n\nCONTACTS:\n${JSON.stringify(candidates.map(compactContact))}`,
      rankedMatchesJsonSchema,
      rankedMatchesSchema,
      undefined,
      {
        maxAttempts: 2,
        numPredict: 900,
        temperature: 0.1,
        diagnosticLabel: 'network-search-v1',
      },
    );
    const byId = new Map(candidates.map((contact) => [contact.id, contact]));
    return output.matches.flatMap((match) => {
      const contact = byId.get(match.id);
      return contact
        ? [{ contact, quality: match.quality, reasons: match.reasons }]
        : [];
    });
  }

  public async parseUpdate(change: string): Promise<NetworkContactPatch> {
    if (!this.generator)
      throw new Error('Pro přirozené aktualizace je nutná konfigurace Ollama.');
    const output = await this.generator.generateStructured(
      `Convert one Czech or English contact update into exactly one field change for this model: name, metDate, metAt, phone, email, web, socialNetwork, meetingNote, contactType, followUp, active. Preserve the user's wording. Use boolean only for active. Do not change unrelated fields.\n\nCHANGE:\n${change}`,
      updateJsonSchema,
      updateSchema,
      undefined,
      {
        maxAttempts: 2,
        numPredict: 200,
        temperature: 0,
        diagnosticLabel: 'network-update-v1',
      },
    );
    if (output.field === 'active' && typeof output.value !== 'boolean')
      throw new Error('Aktivní kontakt musí být ano/ne.');
    if (output.field !== 'active' && typeof output.value !== 'string')
      throw new Error('Textové pole musí obsahovat text.');
    return { [output.field]: output.value };
  }
}
