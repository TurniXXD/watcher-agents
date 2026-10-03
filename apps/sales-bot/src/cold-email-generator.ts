import type { OllamaProvider } from '@watcher/llm';
import {
  buildColdEmailPrompt,
  COLD_EMAIL_SYSTEM_PROMPT,
  coldEmailJsonSchema,
  coldEmailOutputSchema,
  validateColdEmail,
  type ColdEmailContext,
  type ColdEmailOutput,
} from './prompts/cold-email/index.js';

type StructuredGenerator = Pick<OllamaProvider, 'generateStructured'>;

export class ColdEmailGenerator {
  public constructor(private readonly generator: StructuredGenerator) {}

  public async generate(context: ColdEmailContext): Promise<ColdEmailOutput> {
    const prompt = `${COLD_EMAIL_SYSTEM_PROMPT}\n\n${buildColdEmailPrompt(context)}`;
    let validationErrors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repair =
        attempt === 0
          ? ''
          : `\n\nThe previous draft failed deterministic validation. Correct every issue without changing the verified facts:\n- ${validationErrors.join('\n- ')}`;
      const output = await this.generator.generateStructured(
        `${prompt}${repair}`,
        coldEmailJsonSchema,
        coldEmailOutputSchema,
        undefined,
        {
          maxAttempts: 1,
          numPredict: 512,
          temperature: 0.2,
          diagnosticLabel: 'sales-cold-email-v1',
        },
      );
      validationErrors = validateColdEmail(context, output);
      if (validationErrors.length === 0) return output;
    }
    throw new Error(
      `Cold email failed deterministic validation: ${validationErrors.join('; ')}`,
    );
  }
}
