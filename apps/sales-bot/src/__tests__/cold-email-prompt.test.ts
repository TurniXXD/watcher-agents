import { describe, expect, it, vi } from 'vitest';
import { ColdEmailGenerator } from '../cold-email-generator.js';
import {
  buildColdEmailPrompt,
  COLD_EMAIL_SYSTEM_PROMPT,
  validateColdEmail,
  type ColdEmailContext,
  type ColdEmailOutput,
} from '../prompts/cold-email/index.js';

const context: ColdEmailContext = {
  language: 'cs',
  lead: { firstName: 'Jana', position: 'jednatelka' },
  company: {
    name: 'Example s.r.o.',
    website: 'https://example.cz',
    countryCode: 'CZ',
  },
  research: {
    facts: ['The public website includes a contact page.'],
  },
  offer: { service: 'web development', capabilities: ['website review'] },
};

const validOutput: ColdEmailOutput = {
  language: 'cs',
  subject: 'Návrhy pro web Example',
  body: 'Dobrý den,\n\nna vašem webu je samostatná kontaktní stránka. Mohu poslat dva konkrétní návrhy, jak zjednodušit cestu k poptávce?',
  personalizationReason: 'Public website structure',
  personalizationFact: 'The public website includes a contact page.',
  confidence: 0.9,
  insufficientPersonalizationData: false,
};

describe('cold email prompt', () => {
  it('includes delimited dynamic context and requested language', () => {
    const prompt = buildColdEmailPrompt(context);
    expect(prompt).toContain('<lead_context format="application/json">');
    expect(prompt).toContain('</lead_context>');
    expect(prompt).toContain('"name": "Example s.r.o."');
    expect(prompt).toContain('Required customer-facing language: cs');
  });

  it('does not duplicate the system prompt in the user prompt', () => {
    expect(buildColdEmailPrompt(context)).not.toContain(
      COLD_EMAIL_SYSTEM_PROMPT,
    );
  });
});

describe('cold email output validation', () => {
  it('accepts a grounded Czech draft', () => {
    expect(validateColdEmail(context, validOutput)).toEqual([]);
  });

  it('rejects English output for a Czech request', () => {
    const errors = validateColdEmail(context, {
      ...validOutput,
      language: 'en',
      body: 'Hello, your website has a dedicated contact page and the services are clearly listed for customers. Would it be useful if I sent two concrete suggestions?',
    });
    expect(errors.join(' ')).toMatch(/language/u);
  });

  it('rejects an invented personalization fact', () => {
    expect(
      validateColdEmail(context, {
        ...validOutput,
        personalizationFact: 'The company doubled revenue last year.',
      }),
    ).toContain('personalizationFact must exactly match a supplied fact');
  });

  it('allows insufficient data only with no personalization fact', () => {
    expect(
      validateColdEmail(
        { ...context, research: { facts: [] } },
        {
          ...validOutput,
          personalizationFact: null,
          insufficientPersonalizationData: true,
        },
      ),
    ).toEqual([]);
  });
});

describe('ColdEmailGenerator', () => {
  it('performs one constrained retry after deterministic validation fails', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({
        ...validOutput,
        personalizationFact: 'Invented fact',
      })
      .mockResolvedValueOnce(validOutput);
    const generator = new ColdEmailGenerator({
      generateStructured,
    } as never);

    await expect(generator.generate(context)).resolves.toEqual(validOutput);
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[1]?.[0]).toContain(
      'personalizationFact must exactly match a supplied fact',
    );
  });

  it('never accepts an invalid second draft', async () => {
    const invalid = { ...validOutput, body: `${validOutput.body}!` };
    const generateStructured = vi.fn().mockResolvedValue(invalid);
    const generator = new ColdEmailGenerator({
      generateStructured,
    } as never);

    await expect(generator.generate(context)).rejects.toThrow(
      'Cold email failed deterministic validation',
    );
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
