import { z } from 'zod';
import type {
  CandidateProfile,
  JobEvaluationResult,
  NormalizedJob,
  Recommendation,
} from './types.js';

export const JOB_AI_PROMPT_VERSION = 'jobs-v1';
export const JOB_SALES_AI_PROMPT_VERSION = 'jobs-sales-v1';

const aiAssessmentSchema = z.object({
  score: z.number().int().min(0).max(100),
  eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNCERTAIN']),
  matchingSkills: z.array(z.string()).max(50),
  missingSkills: z.array(z.string()).max(50),
  hardBlockers: z.array(z.string()).max(20),
  uncertainties: z.array(z.string()).max(20),
  reasoning: z.string().min(1).max(2_000),
});

const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().min(1) }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type JobAiMetadata = {
  provider: string;
  model: string;
  promptVersion: string;
  aiScore: number;
  tokenUsage?: Record<string, number>;
  estimatedCostUsd?: number;
};

export type JobAiEvaluation = {
  result: JobEvaluationResult;
  metadata: JobAiMetadata;
};

export type JobAiEvaluator = {
  evaluate: (
    job: NormalizedJob,
    profile: CandidateProfile,
    deterministic: JobEvaluationResult,
  ) => Promise<JobAiEvaluation>;
};

type Fetch = typeof globalThis.fetch;

const parseModelJson = (content: string): unknown => {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  return JSON.parse(withoutFence);
};

const recommendationFor = (
  score: number,
  profile: CandidateProfile,
): Recommendation => {
  if (score >= profile.thresholds.excellent) return 'EXCELLENT';
  if (score >= profile.thresholds.strong) return 'STRONG';
  if (score >= profile.thresholds.possible) return 'POSSIBLE';
  return 'LOW';
};

const unique = (values: string[]): string[] => [...new Set(values)];

export class OpenAiCompatibleJobEvaluator implements JobAiEvaluator {
  public constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      provider?: string;
      timeoutMs?: number;
      fetch?: Fetch;
    },
  ) {}

  public async evaluate(
    job: NormalizedJob,
    profile: CandidateProfile,
    deterministic: JobEvaluationResult,
  ): Promise<JobAiEvaluation> {
    const promptVersion =
      profile.evaluationMode === 'SALES_BUSINESS'
        ? JOB_SALES_AI_PROMPT_VERSION
        : JOB_AI_PROMPT_VERSION;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 45_000,
    );
    try {
      const fetcher = this.options.fetch ?? globalThis.fetch;
      const response = await fetcher(
        `${this.options.baseUrl.replace(/\/$/u, '')}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.options.apiKey
              ? { authorization: `Bearer ${this.options.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: this.options.model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  profile.evaluationMode === 'SALES_BUSINESS'
                    ? 'Evaluate this Sales & Business Development career-transition job only from the supplied facts. The candidate has startup/product-validation and technical SaaS/automation/AI experience but zero professional sales, account-management, financial-advisory, revenue-target, or client-portfolio experience. Never convert software engineering into professional sales experience or invent achievements. Identify B2B/B2C, training, fixed salary, commission, bonuses, commission-only risk, MLM-like structures, unclear or misleading compensation, and the financial-advisory business model. Explain the fit clearly. Return JSON only with score, eligibility, matchingSkills, missingSkills, hardBlockers, uncertainties, and reasoning.'
                    : 'Evaluate a job only from the supplied candidate and vacancy facts. Never invent experience. Distinguish mandatory, preferred, and uncertain requirements. Return JSON only with score, eligibility, matchingSkills, missingSkills, hardBlockers, uncertainties, and reasoning.',
              },
              {
                role: 'user',
                content: JSON.stringify({
                  promptVersion,
                  candidate: profile,
                  vacancy: {
                    title: job.title,
                    company: job.company,
                    description: job.description,
                    location: job.location,
                    workMode: job.workMode,
                    remoteRegions: job.remoteRegions,
                    technologyStack: job.technologyStack,
                  },
                  deterministicAssessment: deterministic,
                }),
              },
            ],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new Error(`AI evaluation failed with HTTP ${response.status}`);
      const payload = responseSchema.parse(await response.json());
      const assessment = aiAssessmentSchema.parse(
        parseModelJson(payload.choices[0]!.message.content),
      );

      const score = Math.round(
        deterministic.score * 0.75 + assessment.score * 0.25,
      );
      const hardBlockers = unique([
        ...deterministic.hardBlockers,
        ...assessment.hardBlockers,
      ]);
      const uncertainties = unique([
        ...deterministic.uncertainties,
        ...assessment.uncertainties,
      ]);
      const eligibility = hardBlockers.length
        ? 'INELIGIBLE'
        : deterministic.eligibility === 'UNCERTAIN' ||
            assessment.eligibility === 'UNCERTAIN'
          ? 'UNCERTAIN'
          : assessment.eligibility;
      const tokenUsage = payload.usage
        ? Object.fromEntries(
            Object.entries(payload.usage).filter(
              (entry): entry is [string, number] => entry[1] !== undefined,
            ),
          )
        : undefined;
      return {
        result: {
          score,
          eligibility,
          recommendation: recommendationFor(score, profile),
          matchingSkills: unique([
            ...deterministic.matchingSkills,
            ...assessment.matchingSkills,
          ]),
          missingSkills: unique([
            ...deterministic.missingSkills,
            ...assessment.missingSkills,
          ]),
          hardBlockers,
          uncertainties,
          reasoning:
            profile.evaluationMode === 'SALES_BUSINESS'
              ? `${deterministic.reasoning} AI assessment: ${assessment.reasoning}`
              : assessment.reasoning,
          scoreBreakdown: {
            ...deterministic.scoreBreakdown,
            deterministicScore: deterministic.score,
            aiScore: assessment.score,
          },
        },
        metadata: {
          provider: this.options.provider ?? 'openai-compatible',
          model: this.options.model,
          promptVersion,
          aiScore: assessment.score,
          ...(tokenUsage ? { tokenUsage } : {}),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
