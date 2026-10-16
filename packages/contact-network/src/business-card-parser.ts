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
  done_reason: z.string().optional(),
});

export interface BusinessCardParser {
  parse(image: Uint8Array): Promise<NetworkContactInput>;
}

const structuredContent = (content: string): unknown => {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  if (!trimmed) throw new Error('vision model returned empty content');
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart < 0 || objectEnd < objectStart) {
    throw new Error('vision model did not return a complete JSON object');
  }
  try {
    return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
  } catch {
    throw new Error('vision model returned malformed JSON');
  }
};

const cardToContact = (card: z.infer<typeof businessCardSchema>) => {
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
};

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
      let invalidOutput: Error | undefined;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await this.fetcher(new URL('/api/chat', this.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,
            stream: false,
            think: false,
            format: businessCardJsonSchema,
            options: { temperature: 0, num_predict: 700 },
            messages: [
              {
                role: 'user',
                content:
                  attempt === 1
                    ? 'Read this business card. Extract only text visibly present or a location safely implied by a printed postal address. Never invent skills, interests, relationship strength, services, company facts, or missing values. Use null for every unknown field. Return the complete JSON object required by the supplied schema.'
                    : 'Retry the business-card extraction. Return one complete JSON object matching the supplied schema. Do not return markdown, commentary, or an empty response. Use null for every unknown field.',
                images: [Buffer.from(image).toString('base64')],
              },
            ],
          }),
        });
        if (!response.ok)
          throw new Error(
            `Ollama vision request failed with HTTP ${response.status}`,
          );
        let parsedResponse: z.infer<typeof ollamaResponseSchema>;
        try {
          parsedResponse = ollamaResponseSchema.parse(await response.json());
        } catch {
          invalidOutput = new Error(
            'vision model returned an invalid Ollama response',
          );
          continue;
        }
        try {
          return cardToContact(
            businessCardSchema.parse(
              structuredContent(parsedResponse.message.content),
            ),
          );
        } catch (error) {
          invalidOutput =
            error instanceof Error ? error : new Error(String(error));
        }
      }
      throw new Error(
        `Ollama vision model did not return a complete business-card JSON after 2 attempts (${invalidOutput?.message ?? 'unknown output error'}). Verify that NETWORK_OLLAMA_VISION_MODEL supports images.`,
        { cause: invalidOutput },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
