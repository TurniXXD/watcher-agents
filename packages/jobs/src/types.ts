import { z } from 'zod';

export const jobWorkModeSchema = z.enum([
  'REMOTE',
  'HYBRID',
  'ONSITE',
  'UNKNOWN',
]);

export const candidateProfileSchema = z
  .object({
    name: z.string().trim().min(1),
    professionalTitle: z.string().trim().min(1),
    summary: z.string().trim().min(1).optional(),
    website: z.url().optional(),
    github: z.url().optional(),
    linkedin: z.url().optional(),
    yearsExperience: z.number().int().nonnegative(),
    educationLevel: z.string().trim().min(1),
    languages: z.record(z.string(), z.string()),
    preferredRoles: z.array(z.string()).min(1),
    avoidedRoles: z.array(z.string()).default([]),
    requiredTechnologies: z
      .array(z.string())
      .default(['Next.js', 'React.js', 'Node.js', 'TypeScript']),
    excludedTechnologies: z
      .array(z.string())
      .default(['PHP', 'Java', 'C++', 'Go', '.NET', 'Svelte', 'Python']),
    adjacentRoles: z
      .array(z.string())
      .default([
        'Forward Deployed Engineer',
        'Forward Deployed Project Manager',
        'Technical Project Manager',
        'Technical Program Manager',
        'Implementation Engineer',
        'Solutions Engineer',
      ]),
    preferredContractTypes: z
      .array(z.string())
      .default(['IČO', 'ICO', 'B2B', 'contractor', 'freelance', 'contract']),
    preferredLocations: z.object({
      countries: z.array(z.string()).default(['Czechia']),
      regions: z.array(z.string()).default(['Europe', 'EU', 'Worldwide']),
      cities: z.array(z.string()).default([]),
      remote: z.boolean().default(true),
      hybrid: z.boolean().default(false),
      onsite: z.boolean().default(true),
    }),
    skills: z.array(
      z.object({
        name: z.string().min(1),
        proficiency: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']),
        years: z.number().int().nonnegative().optional(),
      }),
    ),
    experience: z
      .array(
        z.object({
          organization: z.string().trim().min(1),
          via: z.string().trim().min(1).optional(),
          title: z.string().trim().min(1),
          period: z.string().trim().min(1),
          technologies: z.array(z.string()).default([]),
          highlights: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    weights: z
      .object({
        technology: z.number().min(0).max(100).default(30),
        experience: z.number().min(0).max(100).default(20),
        role: z.number().min(0).max(100).default(15),
        location: z.number().min(0).max(100).default(15),
        language: z.number().min(0).max(100).default(10),
        career: z.number().min(0).max(100).default(5),
        conditions: z.number().min(0).max(100).default(5),
      })
      .default({
        technology: 30,
        experience: 20,
        role: 15,
        location: 15,
        language: 10,
        career: 5,
        conditions: 5,
      }),
    thresholds: z
      .object({
        excellent: z.number().int().min(0).max(100).default(85),
        strong: z.number().int().min(0).max(100).default(70),
        possible: z.number().int().min(0).max(100).default(55),
        notify: z.number().int().min(0).max(100).default(70),
      })
      .default({ excellent: 85, strong: 70, possible: 55, notify: 70 }),
  })
  .superRefine((profile, context) => {
    const weightTotal = Object.values(profile.weights).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (Math.abs(weightTotal - 100) > 0.001) {
      context.addIssue({
        code: 'custom',
        path: ['weights'],
        message: 'Scoring weights must add up to 100',
      });
    }
    const { excellent, strong, possible, notify } = profile.thresholds;
    if (!(excellent >= strong && strong >= possible)) {
      context.addIssue({
        code: 'custom',
        path: ['thresholds'],
        message: 'Thresholds must satisfy excellent >= strong >= possible',
      });
    }
    if (notify < possible) {
      context.addIssue({
        code: 'custom',
        path: ['thresholds', 'notify'],
        message:
          'Notification threshold must be at least the possible threshold',
      });
    }
  });

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const normalizedJobSchema = z.object({
  externalId: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  description: z.string().default(''),
  shortDescription: z.string().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  workMode: jobWorkModeSchema.default('UNKNOWN'),
  remoteRegions: z.array(z.string()).default([]),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  salaryCurrency: z.string().optional(),
  salaryPeriod: z.string().optional(),
  contractType: z.string().optional(),
  seniority: z.string().optional(),
  technologyStack: z.array(z.string()).default([]),
  originalUrl: z.url(),
  canonicalApplicationUrl: z.url().optional(),
  publishedAt: z.date().optional(),
  updatedAt: z.date().optional(),
  raw: z.unknown(),
});

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export type SourceCheckpoint = {
  etag?: string;
  lastModified?: string;
  value?: unknown;
};

export type JobSourceResult = {
  jobs: NormalizedJob[];
  checkpoint?: SourceCheckpoint;
  notModified?: boolean;
};

export type JobSourceAdapter = {
  id: string;
  name: string;
  baseUrl: string;
  strategy: 'API' | 'RSS' | 'ATS' | 'SITEMAP' | 'HTML';
  attribution: string;
  fetchIntervalMinutes: number;
  rateLimitPerMinute: number;
  discover: (input: {
    checkpoint?: SourceCheckpoint;
    signal?: AbortSignal;
  }) => Promise<JobSourceResult>;
  fetchDetail?: (
    job: NormalizedJob,
    input: { checkpoint?: SourceCheckpoint; signal?: AbortSignal },
  ) => Promise<NormalizedJob>;
};

export type JobSourceDefinition = {
  id: string;
  name: string;
  baseUrl: string;
  strategy: string;
  enabledByDefault: boolean;
  attribution?: string;
  disabledReason?: string;
  fetchIntervalMinutes?: number;
  rateLimitPerMinute?: number;
  adapter?: JobSourceAdapter;
};

export type Eligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'UNCERTAIN';
export type Recommendation = 'EXCELLENT' | 'STRONG' | 'POSSIBLE' | 'LOW';

export type JobEvaluationResult = {
  score: number;
  eligibility: Eligibility;
  recommendation: Recommendation;
  matchingSkills: string[];
  missingSkills: string[];
  hardBlockers: string[];
  uncertainties: string[];
  reasoning: string;
  scoreBreakdown: Record<string, number>;
};
