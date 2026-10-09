import { z } from 'zod';
import {
  networkContactInputSchema,
  type NetworkContactInput,
} from './types.js';

const businessCardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(300).nullish(),
  role: z.string().trim().max(300).nullish(),
  email: z.string().trim().max(300).nullish(),
  phone: z.string().trim().max(100).nullish(),
  website: z.string().trim().max(500).nullish(),
  linkedin: z.string().trim().max(500).nullish(),
  location: z.string().trim().max(500).nullish(),
});

const businessCardJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'company',
    'role',
    'email',
    'phone',
    'website',
    'linkedin',
    'location',
  ],
  properties: {
    name: { type: 'string' },
    company: { type: ['string', 'null'] },
    role: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    website: { type: ['string', 'null'] },
    linkedin: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
  },
} as const;

const ollamaResponseSchema = z.object({
  message: z.object({ content: z.string() }),
});

export interface BusinessCardParser {
  parse(image: Uint8Array): Promise<NetworkContactInput>;
}

export class OllamaBusinessCardParser implements BusinessCardParser {
  public constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async parse(image: Uint8Array): Promise<NetworkContactInput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(new URL('/api/chat', this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: businessCardJsonSchema,
          options: { temperature: 0, num_predict: 500 },
          messages: [
            {
              role: 'user',
              content:
                'Read this business card. Extract only text visibly present or a location safely implied by a printed postal address. Never invent skills, interests, relationship strength, services, company facts, or missing values. Use null for every unknown field.',
              images: [Buffer.from(image).toString('base64')],
            },
          ],
        }),
      });
      if (!response.ok)
        throw new Error(
          `Ollama vision request failed with HTTP ${response.status}`,
        );
      const parsedResponse = ollamaResponseSchema.parse(await response.json());
      const card = businessCardSchema.parse(
        JSON.parse(parsedResponse.message.content),
      );
      const noteParts = [
        card.company ? `Firma: ${card.company}` : undefined,
        card.role ? `Role: ${card.role}` : undefined,
        card.location ? `Adresa z vizitky: ${card.location}` : undefined,
      ].filter((value): value is string => Boolean(value));
      return networkContactInputSchema.parse({
        name: card.name,
        ...(card.phone ? { phone: card.phone } : {}),
        ...(card.email ? { email: card.email } : {}),
        ...(card.website ? { web: card.website } : {}),
        ...(card.linkedin ? { socialNetwork: card.linkedin } : {}),
        ...(noteParts.length ? { meetingNote: noteParts.join('. ') } : {}),
        ...(card.role ? { contactType: card.role } : {}),
        active: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
