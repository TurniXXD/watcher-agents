import { candidateProfileSchema } from '@watcher/jobs';
import { z } from 'zod';

const optionalText = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  z.string().optional(),
);

const commaSeparatedIdentifiers = z
  .string()
  .default('')
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]);

const defaultProfile = {
  name: 'Jakub Vantuch',
  professionalTitle: 'Full-Stack Developer',
  summary:
    'Full-stack developer with 5+ years of professional experience building web applications, internal systems, APIs, and integrations.',
  website: 'https://vantuch.dev',
  github: 'https://github.com/TurniXXD',
  linkedin: 'https://linkedin.com/in/jakub-vantuch',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school, Information Technology',
  languages: { Czech: 'native', English: 'B2', Spanish: 'A1' },
  preferredRoles: [
    'Full-Stack Developer',
    'Full-Stack Engineer',
    'Software Engineer',
    'Frontend Developer',
    'Frontend Engineer',
    'React Developer',
    'Next.js Developer',
    'TypeScript Developer',
    'Node.js Developer',
    'Backend Developer',
    'API Developer',
    'Integration Engineer',
    'Internal Tools Engineer',
    'Product Engineer',
    'SaaS Engineer',
    'AI Application Engineer',
    'Automation Engineer',
    'Forward Deployed Engineer',
    'Forward Deployed Project Manager',
    'Technical Project Manager',
    'Technical Program Manager',
    'Implementation Engineer',
    'Solutions Engineer',
  ],
  avoidedRoles: [
    'IT Support',
    'Helpdesk',
    'Manual QA',
    'System Administrator',
    'PLC Programmer',
    'Recruiter',
    'Sales Representative',
    'iOS Developer',
    'Android Developer',
  ],
  requiredTechnologies: ['Next.js', 'React.js', 'Node.js', 'TypeScript'],
  excludedTechnologies: ['PHP', 'Java', 'C++', 'Go', '.NET', 'Svelte'],
  adjacentRoles: [
    'Forward Deployed Engineer',
    'Forward Deployed Project Manager',
    'Technical Project Manager',
    'Technical Program Manager',
    'Implementation Engineer',
    'Solutions Engineer',
  ],
  preferredLocations: {
    countries: ['Czechia', 'Czech Republic', 'Switzerland', 'Iceland'],
    regions: ['Europe', 'EU', 'Worldwide'],
    cities: [
      'Brno',
      'Prague',
      'Ostrava',
      'Frýdek-Místek',
      'Zurich',
      'Zug',
      'Basel',
      'Bern',
      'Geneva',
      'Lausanne',
      'Lugano',
      'Reykjavik',
    ],
    remote: true,
    hybrid: true,
    onsite: true,
  },
  skills: [
    'React',
    'Next.js',
    'TypeScript',
    'JavaScript',
    'Node.js',
    'REST APIs',
    'GraphQL',
    'PostgreSQL',
    'Application architecture',
    'Complex data structures',
    'Backend integrations',
    'Full-stack web development',
    'Docker',
    'CI/CD',
    'Linux',
    'Git',
    'Responsive frontend development',
    'CMS integrations',
    'Third-party service integrations',
    'Web application maintenance',
    'Refactoring',
  ].map((name) => ({ name, proficiency: 'ADVANCED' as const })),
  experience: [
    {
      organization: 'Robe',
      via: 'Appio',
      title: 'Frontend Developer',
      period: '2024–present',
      technologies: [
        'Next.js',
        'TypeScript',
        'styled-components',
        'PostgreSQL',
      ],
      highlights: [
        'Product website architecture, refactoring, and complex product data.',
      ],
    },
    {
      organization: 'Robe PLM',
      via: 'Appio',
      title: 'Frontend Developer',
      period: '2024–present',
      technologies: ['Next.js', 'TypeScript', 'MUI', 'PostgreSQL'],
      highlights: [
        'Administration, visualization, and editing of complex hierarchical and relational product data.',
      ],
    },
    {
      organization: 'My213',
      via: 'ProRocketeers',
      title: 'Full-Stack Developer',
      period: '2022–2023',
      technologies: [
        'Next.js',
        'Node.js',
        'Expo',
        'TypeScript',
        'GraphQL',
        'PostgreSQL',
        'Docker',
      ],
      highlights: [
        'Backend services, APIs, Bank iD, Reservatic, and other external integrations.',
      ],
    },
    {
      organization: 'Revizio',
      title: 'Full-Stack Developer and Co-Founder',
      period: '2023–2025',
      technologies: [
        'Next.js',
        'Node.js',
        'TypeScript',
        'GraphQL',
        'PostgreSQL',
      ],
      highlights: [
        'Inspection report dashboard, report template editor, product design, and validation.',
      ],
    },
    {
      organization: 'Kinedok',
      via: 'Appio',
      title: 'Frontend Developer',
      period: '2025–present',
      technologies: ['Next.js', 'TypeScript', 'PostgreSQL'],
      highlights: [
        'Public website and administration system stability and reliability improvements.',
      ],
    },
    {
      organization: 'Ondrášek',
      via: 'ProRocketeers',
      title: 'Full-Stack Developer',
      period: '2021–2022',
      technologies: [
        'Next.js',
        'Node.js',
        'Strapi',
        'TypeScript',
        'GraphQL',
        'PostgreSQL',
      ],
      highlights: [
        'PHP migration, reusable multi-tenant frontend architecture, and Strapi CMS integration.',
      ],
    },
  ],
  weights: {},
  thresholds: {},
};

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    JOBS_TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    JOBS_TIMEZONE: z.string().default('Europe/Prague'),
    JOBS_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4090),
    JOBS_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .default(30_000),
    JOBS_DETAIL_REFRESH_HOURS: z.coerce.number().int().min(1).default(72),
    JOBS_GREENHOUSE_BOARDS: commaSeparatedIdentifiers,
    JOBS_LEVER_SITES: commaSeparatedIdentifiers,
    JOBS_ASHBY_BOARDS: commaSeparatedIdentifiers,
    JOBS_SMARTRECRUITERS_COMPANIES: commaSeparatedIdentifiers,
    JOBS_WORKABLE_ACCOUNTS: commaSeparatedIdentifiers,
    JOBS_RECRUITEE_COMPANIES: commaSeparatedIdentifiers,
    JOBS_TEAMTAILOR_DOMAINS: commaSeparatedIdentifiers,
    JOBS_CANDIDATE_NAME: z.string().trim().min(1).default('Jakub Vantuch'),
    JOBS_CANDIDATE_PROFILE_JSON: optionalText,
    JOBS_AI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    JOBS_AI_BASE_URL: z.url().default('http://host.docker.internal:11434'),
    JOBS_AI_MODEL: z.string().trim().min(1).default('qwen3:8b'),
    JOBS_AI_API_KEY: optionalText,
    JOBS_AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(45_000),
    JOBS_EMAIL_WEBHOOK_URL: optionalText.pipe(z.url().optional()),
    JOBS_EMAIL_WEBHOOK_API_KEY: optionalText,
    JOBS_EMAIL_RECIPIENT: optionalText.pipe(z.email().optional()),
    NOTION_API_KEY: optionalText,
    JOBS_NOTION_DATA_SOURCE_ID: optionalText,
    NOTION_API_VERSION: z.string().trim().min(1).default('2026-03-11'),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((value, context) => {
    if (
      Boolean(value.JOBS_EMAIL_WEBHOOK_URL) !==
      Boolean(value.JOBS_EMAIL_RECIPIENT)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JOBS_EMAIL_WEBHOOK_URL'],
        message:
          'JOBS_EMAIL_WEBHOOK_URL and JOBS_EMAIL_RECIPIENT must be configured together',
      });
    }
    if (value.JOBS_EMAIL_WEBHOOK_API_KEY && !value.JOBS_EMAIL_WEBHOOK_URL) {
      context.addIssue({
        code: 'custom',
        path: ['JOBS_EMAIL_WEBHOOK_API_KEY'],
        message:
          'JOBS_EMAIL_WEBHOOK_API_KEY requires JOBS_EMAIL_WEBHOOK_URL and JOBS_EMAIL_RECIPIENT',
      });
    }
    if (
      Boolean(value.NOTION_API_KEY) !==
      Boolean(value.JOBS_NOTION_DATA_SOURCE_ID)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JOBS_NOTION_DATA_SOURCE_ID'],
        message:
          'NOTION_API_KEY and JOBS_NOTION_DATA_SOURCE_ID must be configured together',
      });
    }
  });

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  CANDIDATE_PROFILE: candidateProfileSchema.parse(
    parsed.JOBS_CANDIDATE_PROFILE_JSON
      ? JSON.parse(parsed.JOBS_CANDIDATE_PROFILE_JSON)
      : { ...defaultProfile, name: parsed.JOBS_CANDIDATE_NAME },
  ),
};
