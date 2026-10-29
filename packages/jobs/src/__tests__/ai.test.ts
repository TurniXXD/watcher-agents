import { describe, expect, it, vi } from 'vitest';
import {
  JOB_SALES_AI_PROMPT_VERSION,
  OpenAiCompatibleJobEvaluator,
} from '../ai.js';
import { buildSalesBusinessProfile } from '../sales-evaluation.js';
import { candidateProfileSchema } from '../types.js';

const profile = candidateProfileSchema.parse({
  name: 'Test candidate',
  professionalTitle: 'Full-Stack Developer',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school',
  languages: { Czech: 'native', English: 'B2' },
  preferredRoles: ['Full-Stack Developer'],
  preferredLocations: { countries: ['Czechia'] },
  skills: [{ name: 'TypeScript', proficiency: 'ADVANCED' }],
});

describe('OpenAiCompatibleJobEvaluator', () => {
  it('validates structured output and preserves deterministic blockers', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 90,
                    eligibility: 'ELIGIBLE',
                    matchingSkills: ['TypeScript'],
                    missingSkills: [],
                    hardBlockers: [],
                    uncertainties: [],
                    reasoning: 'Strong TypeScript fit.',
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 30,
              total_tokens: 130,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const evaluator = new OpenAiCompatibleJobEvaluator({
      baseUrl: 'http://ollama.example',
      model: 'test-model',
      provider: 'ollama',
      fetch,
    });
    const result = await evaluator.evaluate(
      {
        sourceId: 'test',
        externalId: '1',
        title: 'Full-Stack Developer',
        company: 'Example',
        description: 'Bachelor degree is required.',
        workMode: 'REMOTE',
        remoteRegions: ['Europe'],
        technologyStack: ['TypeScript'],
        originalUrl: 'https://example.com/job',
        raw: {},
      },
      profile,
      {
        score: 50,
        eligibility: 'INELIGIBLE',
        recommendation: 'LOW',
        matchingSkills: ['TypeScript'],
        missingSkills: [],
        hardBlockers: ['Mandatory degree requirement'],
        uncertainties: [],
        reasoning: 'Rejected.',
        scoreBreakdown: { technology: 20 },
      },
    );

    expect(result.result.eligibility).toBe('INELIGIBLE');
    expect(result.result.hardBlockers).toContain(
      'Mandatory degree requirement',
    );
    expect(result.result.score).toBe(60);
    expect(result.metadata).toMatchObject({
      provider: 'ollama',
      model: 'test-model',
      aiScore: 90,
      tokenUsage: { total_tokens: 130 },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://ollama.example/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects malformed model output', async () => {
    const evaluator = new OpenAiCompatibleJobEvaluator({
      baseUrl: 'https://ai.example',
      model: 'test',
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
          ),
      ),
    });
    await expect(
      evaluator.evaluate(
        {
          sourceId: 'test',
          externalId: '1',
          title: 'Developer',
          company: 'Example',
          description: '',
          workMode: 'UNKNOWN',
          remoteRegions: [],
          technologyStack: [],
          originalUrl: 'https://example.com/job',
          raw: {},
        },
        profile,
        {
          score: 50,
          eligibility: 'UNCERTAIN',
          recommendation: 'LOW',
          matchingSkills: [],
          missingSkills: [],
          hardBlockers: [],
          uncertainties: [],
          reasoning: 'Unknown.',
          scoreBreakdown: {},
        },
      ),
    ).rejects.toThrow();
  });

  it('uses the sales career-transition prompt without inventing professional sales experience', async () => {
    let requestBody: BodyInit | null | undefined;
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        void url;
        requestBody = init?.body;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 80,
                    eligibility: 'ELIGIBLE',
                    matchingSkills: ['SaaS products'],
                    missingSkills: [],
                    hardBlockers: [],
                    uncertainties: [],
                    reasoning: 'Entry-level B2B role with training.',
                  }),
                },
              },
            ],
          }),
        );
      },
    );
    const evaluator = new OpenAiCompatibleJobEvaluator({
      baseUrl: 'https://ai.example',
      model: 'test',
      fetch,
    });
    const salesProfile = buildSalesBusinessProfile(profile);
    const deterministic = {
      score: 75,
      eligibility: 'ELIGIBLE' as const,
      recommendation: 'STRONG' as const,
      matchingSkills: ['SaaS products'],
      missingSkills: [],
      hardBlockers: [],
      uncertainties: [],
      reasoning:
        'No professional sales achievements, revenue targets, or managed client portfolio were assumed.',
      scoreBreakdown: { salesCategoryAdjustments: 10 },
    };

    const result = await evaluator.evaluate(
      {
        sourceId: 'test',
        externalId: 'sales-1',
        title: 'Business Development Representative',
        company: 'Example SaaS',
        description: 'Entry-level B2B role with training and fixed salary.',
        workMode: 'REMOTE',
        remoteRegions: ['Czechia'],
        technologyStack: [],
        originalUrl: 'https://example.com/sales-job',
        raw: {},
      },
      salesProfile,
      deterministic,
    );

    if (typeof requestBody !== 'string')
      throw new Error('Expected a JSON request body');
    const request = JSON.parse(requestBody) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.messages[0]?.content).toContain('zero professional sales');
    expect(request.messages[1]?.content).toContain(JOB_SALES_AI_PROMPT_VERSION);
    expect(result.metadata.promptVersion).toBe(JOB_SALES_AI_PROMPT_VERSION);
    expect(result.result.reasoning).toContain(deterministic.reasoning);
  });
});
