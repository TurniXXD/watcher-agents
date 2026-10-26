import { z } from 'zod';
import { fetchJobSource } from './http.js';
import {
  canonicalizeUrl,
  cleanHtml,
  extractTechnologyStack,
} from './normalization.js';
import { createRssJobSourceAdapter } from './sources.js';
import {
  normalizedJobSchema,
  type JobSourceAdapter,
  type JobSourceDefinition,
  type NormalizedJob,
} from './types.js';

export type AtsSourceConfiguration = {
  greenhouseBoards?: readonly string[];
  leverSites?: readonly string[];
  ashbyBoards?: readonly string[];
  smartRecruitersCompanies?: readonly string[];
  workableAccounts?: readonly string[];
  recruiteeCompanies?: readonly string[];
  teamtailorDomains?: readonly string[];
};

const identifierSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u,
  )
  .refine(
    (value) =>
      value !== 'localhost' &&
      !value.endsWith('.localhost') &&
      !value.endsWith('.local'),
    'A public careers-site domain is required',
  );

const parseIdentifiers = (values: readonly string[] | undefined): string[] => [
  ...new Set((values ?? []).map((value) => identifierSchema.parse(value))),
];

const optionalDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const normalized = (input: {
  sourceId: string;
  externalId: string | number;
  title: string;
  company: string;
  description?: string | undefined;
  location?: string | undefined;
  workMode?: NormalizedJob['workMode'] | undefined;
  originalUrl: string;
  applicationUrl?: string | undefined;
  publishedAt?: string | undefined;
  updatedAt?: string | undefined;
  contractType?: string | undefined;
  salaryMin?: number | undefined;
  salaryMax?: number | undefined;
  salaryCurrency?: string | undefined;
  salaryPeriod?: string | undefined;
  tags?: string | undefined;
  raw: unknown;
}): NormalizedJob => {
  const description = cleanHtml(input.description ?? '');
  const location = input.location?.trim() || undefined;
  const remote = /\bremote\b|worldwide|anywhere/iu.test(
    `${location ?? ''} ${description}`,
  );
  const hybrid = /\bhybrid\b/iu.test(`${location ?? ''} ${description}`);
  return normalizedJobSchema.parse({
    externalId: String(input.externalId),
    sourceId: input.sourceId,
    title: input.title,
    company: input.company,
    description,
    shortDescription: description.slice(0, 500),
    ...(location ? { location } : {}),
    workMode:
      input.workMode ??
      (hybrid ? 'HYBRID' : remote ? 'REMOTE' : location ? 'ONSITE' : 'UNKNOWN'),
    remoteRegions: remote && location ? [location] : [],
    ...(input.contractType ? { contractType: input.contractType } : {}),
    ...(input.salaryMin === undefined ? {} : { salaryMin: input.salaryMin }),
    ...(input.salaryMax === undefined ? {} : { salaryMax: input.salaryMax }),
    ...(input.salaryCurrency ? { salaryCurrency: input.salaryCurrency } : {}),
    ...(input.salaryPeriod ? { salaryPeriod: input.salaryPeriod } : {}),
    technologyStack: extractTechnologyStack(
      `${input.title} ${input.tags ?? ''} ${description}`,
    ),
    originalUrl: canonicalizeUrl(input.originalUrl),
    ...(input.applicationUrl
      ? { canonicalApplicationUrl: canonicalizeUrl(input.applicationUrl) }
      : {}),
    ...(optionalDate(input.publishedAt)
      ? { publishedAt: optionalDate(input.publishedAt) }
      : {}),
    ...(optionalDate(input.updatedAt)
      ? { updatedAt: optionalDate(input.updatedAt) }
      : {}),
    raw: input.raw,
  });
};

const multiTenantAdapter = (input: {
  id: string;
  name: string;
  baseUrl: string;
  tenants: readonly string[];
  discoverTenant: (
    tenant: string,
    signal: AbortSignal | undefined,
  ) => Promise<NormalizedJob[]>;
}): JobSourceAdapter => ({
  id: input.id,
  name: input.name,
  baseUrl: input.baseUrl,
  strategy: 'ATS',
  attribution: `Published jobs from configured ${input.name} career boards`,
  fetchIntervalMinutes: 240,
  rateLimitPerMinute: 30,
  discover: async ({ signal }) => {
    const results = await Promise.allSettled(
      input.tenants.map((tenant) => input.discoverTenant(tenant, signal)),
    );
    const jobs = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    if (jobs.length === 0) {
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failure) throw failure.reason;
    }
    return { jobs };
  },
});

const greenhouseJobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  updated_at: z.string().optional(),
  location: z.object({ name: z.string().optional() }).optional(),
  absolute_url: z.url(),
  content: z.string().optional(),
  departments: z.array(z.object({ name: z.string() })).optional(),
});

export const parseGreenhouseJob = (input: {
  sourceId: string;
  board: string;
  company?: string;
  workMode?: NormalizedJob['workMode'];
  job: unknown;
}): NormalizedJob => {
  const job = greenhouseJobSchema.parse(input.job);
  return normalized({
    sourceId: input.sourceId,
    externalId: `${input.board}:${job.id}`,
    title: job.title,
    company: input.company ?? input.board,
    description: job.content,
    location: job.location?.name,
    workMode: input.workMode,
    originalUrl: job.absolute_url,
    applicationUrl: job.absolute_url,
    updatedAt: job.updated_at,
    tags: job.departments?.map(({ name }) => name).join(' '),
    raw: { board: input.board, job },
  });
};

const greenhouseAdapter = (
  boards: readonly string[],
  options: {
    id?: string;
    name?: string;
    baseUrl?: string;
    company?: string;
    workMode?: NormalizedJob['workMode'];
  } = {},
): JobSourceAdapter =>
  multiTenantAdapter({
    id: options.id ?? 'greenhouse',
    name: options.name ?? 'Greenhouse',
    baseUrl: options.baseUrl ?? 'https://www.greenhouse.com',
    tenants: boards,
    discoverTenant: async (board, signal) => {
      const response = await fetchJobSource(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
        { accept: 'application/json', ...(signal ? { signal } : {}) },
      );
      const payload = z
        .object({ jobs: z.array(greenhouseJobSchema) })
        .parse(await response.json());
      return payload.jobs.map((job) =>
        parseGreenhouseJob({
          sourceId: options.id ?? 'greenhouse',
          board,
          ...(options.company ? { company: options.company } : {}),
          ...(options.workMode ? { workMode: options.workMode } : {}),
          job,
        }),
      );
    },
  });

export const createAgodaCareersAdapter = (): JobSourceAdapter => ({
  ...greenhouseAdapter(['agoda'], {
    id: 'agoda-careers',
    name: 'Agoda Careers',
    baseUrl: 'https://careersatagoda.com',
    company: 'Agoda',
    workMode: 'HYBRID',
  }),
  attribution: 'Jobs by Agoda Careers via the public Greenhouse Job Board API',
});

const leverJobSchema = z.object({
  id: z.string(),
  text: z.string(),
  categories: z
    .object({
      location: z.string().optional(),
      allLocations: z.array(z.string()).optional(),
      commitment: z.string().optional(),
      team: z.string().optional(),
      department: z.string().optional(),
    })
    .default({}),
  descriptionPlain: z.string().optional(),
  hostedUrl: z.url(),
  applyUrl: z.url().optional(),
  workplaceType: z.string().optional(),
  salaryRange: z
    .object({
      currency: z.string().optional(),
      interval: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});

const leverAdapter = (sites: readonly string[]): JobSourceAdapter =>
  multiTenantAdapter({
    id: 'lever',
    name: 'Lever',
    baseUrl: 'https://www.lever.co',
    tenants: sites,
    discoverTenant: async (site, signal) => {
      const response = await fetchJobSource(
        `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`,
        { accept: 'application/json', ...(signal ? { signal } : {}) },
      );
      const jobs = z.array(leverJobSchema).parse(await response.json());
      return jobs.map((job) =>
        normalized({
          sourceId: 'lever',
          externalId: `${site}:${job.id}`,
          title: job.text,
          company: site,
          description: job.descriptionPlain,
          location:
            job.categories.allLocations?.join(', ') ?? job.categories.location,
          workMode:
            job.workplaceType === 'remote'
              ? 'REMOTE'
              : job.workplaceType === 'hybrid'
                ? 'HYBRID'
                : job.workplaceType === 'on-site'
                  ? 'ONSITE'
                  : undefined,
          originalUrl: job.hostedUrl,
          applicationUrl: job.applyUrl,
          contractType: job.categories.commitment,
          salaryMin: job.salaryRange?.min,
          salaryMax: job.salaryRange?.max,
          salaryCurrency: job.salaryRange?.currency,
          salaryPeriod: job.salaryRange?.interval,
          tags: `${job.categories.team ?? ''} ${job.categories.department ?? ''}`,
          raw: { site, job },
        }),
      );
    },
  });

const ashbyJobSchema = z.object({
  title: z.string(),
  location: z.string().optional(),
  department: z.string().optional(),
  team: z.string().optional(),
  isListed: z.boolean().optional().default(true),
  isRemote: z.boolean().optional(),
  workplaceType: z.string().optional(),
  descriptionPlain: z.string().optional(),
  publishedAt: z.string().optional(),
  employmentType: z.string().optional(),
  jobUrl: z.url(),
  applyUrl: z.url().optional(),
});

const ashbyAdapter = (boards: readonly string[]): JobSourceAdapter =>
  multiTenantAdapter({
    id: 'ashby',
    name: 'Ashby',
    baseUrl: 'https://www.ashbyhq.com',
    tenants: boards,
    discoverTenant: async (board, signal) => {
      const response = await fetchJobSource(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
        { accept: 'application/json', ...(signal ? { signal } : {}) },
      );
      const payload = z
        .object({ jobs: z.array(ashbyJobSchema) })
        .parse(await response.json());
      return payload.jobs
        .filter((job) => job.isListed)
        .map((job) =>
          normalized({
            sourceId: 'ashby',
            externalId: `${board}:${new URL(job.jobUrl).pathname.split('/').filter(Boolean).at(-1) ?? job.jobUrl}`,
            title: job.title,
            company: board,
            description: job.descriptionPlain,
            location: job.location,
            workMode:
              job.isRemote || job.workplaceType === 'Remote'
                ? 'REMOTE'
                : job.workplaceType === 'Hybrid'
                  ? 'HYBRID'
                  : job.workplaceType === 'OnSite'
                    ? 'ONSITE'
                    : undefined,
            originalUrl: job.jobUrl,
            applicationUrl: job.applyUrl,
            publishedAt: job.publishedAt,
            contractType: job.employmentType,
            tags: `${job.department ?? ''} ${job.team ?? ''}`,
            raw: { board, job },
          }),
        );
    },
  });

const smartRecruitersJobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  releasedDate: z.string().optional(),
  company: z.object({ name: z.string().optional() }).optional(),
  location: z
    .object({
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      remote: z.boolean().optional(),
    })
    .optional(),
  department: z.object({ label: z.string().optional() }).optional(),
  function: z.object({ label: z.string().optional() }).optional(),
  typeOfEmployment: z.object({ label: z.string().optional() }).optional(),
  experienceLevel: z.object({ label: z.string().optional() }).optional(),
  ref: z.url().optional(),
  jobAd: z
    .object({
      sections: z
        .object({
          jobDescription: z.object({ text: z.string() }).optional(),
          qualifications: z.object({ text: z.string() }).optional(),
          additionalInformation: z.object({ text: z.string() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

const smartRecruitersAdapter = (
  companies: readonly string[],
): JobSourceAdapter =>
  multiTenantAdapter({
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    baseUrl: 'https://www.smartrecruiters.com',
    tenants: companies,
    discoverTenant: async (company, signal) => {
      const response = await fetchJobSource(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100&offset=0`,
        { accept: 'application/json', ...(signal ? { signal } : {}) },
      );
      const payload = z
        .object({ content: z.array(smartRecruitersJobSchema) })
        .parse(await response.json());
      return payload.content.map((job) => {
        const location = [
          job.location?.city,
          job.location?.region,
          job.location?.country,
        ]
          .filter(Boolean)
          .join(', ');
        const description = [
          job.jobAd?.sections?.jobDescription?.text,
          job.jobAd?.sections?.qualifications?.text,
          job.jobAd?.sections?.additionalInformation?.text,
        ]
          .filter(Boolean)
          .join('\n');
        const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(job.id)}`;
        return normalized({
          sourceId: 'smartrecruiters',
          externalId: `${company}:${job.id}`,
          title: job.name,
          company: job.company?.name ?? company,
          description,
          location: location || undefined,
          workMode: job.location?.remote ? 'REMOTE' : undefined,
          originalUrl: url,
          applicationUrl: url,
          publishedAt: job.releasedDate,
          contractType: job.typeOfEmployment?.label,
          tags: `${job.department?.label ?? ''} ${job.function?.label ?? ''} ${job.experienceLevel?.label ?? ''}`,
          raw: { company, job },
        });
      });
    },
  });

const workableJobSchema = z.object({
  shortcode: z.string(),
  title: z.string(),
  description: z.string().optional(),
  requirements: z.string().optional(),
  benefits: z.string().optional(),
  department: z.string().optional(),
  location: z
    .object({
      location_str: z.string().optional(),
      telecommuting: z.boolean().optional(),
      workplace_type: z.string().optional(),
    })
    .optional(),
  url: z.url().optional(),
  application_url: z.url().optional(),
  shortlink: z.url().optional(),
  created_at: z.string().optional(),
});

const workableAdapter = (accounts: readonly string[]): JobSourceAdapter =>
  multiTenantAdapter({
    id: 'workable',
    name: 'Workable',
    baseUrl: 'https://www.workable.com',
    tenants: accounts,
    discoverTenant: async (account, signal) => {
      const response = await fetchJobSource(
        `https://www.workable.com/api/accounts/${encodeURIComponent(account)}?details=true`,
        { accept: 'application/json', ...(signal ? { signal } : {}) },
      );
      const payload = z
        .object({ jobs: z.array(workableJobSchema) })
        .passthrough()
        .parse(await response.json());
      return payload.jobs.map((job) => {
        const url =
          job.shortlink ??
          job.url ??
          `https://apply.workable.com/${encodeURIComponent(account)}/j/${encodeURIComponent(job.shortcode)}`;
        return normalized({
          sourceId: 'workable',
          externalId: `${account}:${job.shortcode}`,
          title: job.title,
          company: account,
          description: [job.description, job.requirements, job.benefits]
            .filter(Boolean)
            .join('\n'),
          location: job.location?.location_str,
          workMode:
            job.location?.telecommuting ||
            job.location?.workplace_type === 'remote'
              ? 'REMOTE'
              : job.location?.workplace_type === 'hybrid'
                ? 'HYBRID'
                : undefined,
          originalUrl: url,
          applicationUrl: job.application_url ?? url,
          publishedAt: job.created_at,
          tags: job.department,
          raw: { account, job },
        });
      });
    },
  });

const recruiteeJobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  company_name: z.string().optional(),
  description: z.string().optional(),
  requirements: z.string().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  careers_url: z.url().optional(),
  slug: z.string().optional(),
  published_at: z.string().optional(),
  employment_type_code: z.string().optional(),
  department: z.string().optional(),
});

const recruiteeAdapter = (companies: readonly string[]): JobSourceAdapter =>
  multiTenantAdapter({
    id: 'recruitee',
    name: 'Recruitee',
    baseUrl: 'https://recruitee.com',
    tenants: companies,
    discoverTenant: async (company, signal) => {
      const response = await fetchJobSource(
        `https://${company}.recruitee.com/api/offers`,
        { accept: 'application/json', ...(signal ? { signal } : {}) },
      );
      const payload = z
        .object({ offers: z.array(recruiteeJobSchema) })
        .parse(await response.json());
      return payload.offers.map((job) => {
        const url =
          job.careers_url ??
          `https://${company}.recruitee.com/o/${encodeURIComponent(job.slug ?? job.id)}`;
        return normalized({
          sourceId: 'recruitee',
          externalId: `${company}:${job.id}`,
          title: job.title,
          company: job.company_name ?? company,
          description: [job.description, job.requirements]
            .filter(Boolean)
            .join('\n'),
          location: job.location,
          workMode: job.remote ? 'REMOTE' : undefined,
          originalUrl: url,
          applicationUrl: url,
          publishedAt: job.published_at,
          contractType: job.employment_type_code,
          tags: job.department,
          raw: { company, job },
        });
      });
    },
  });

const teamtailorAdapter = (domains: readonly string[]): JobSourceAdapter => {
  const feeds = domains.map((domain) =>
    createRssJobSourceAdapter({
      id: 'teamtailor',
      name: 'Teamtailor',
      url: `https://${domain}/jobs.rss?per_page=200`,
      baseUrl: `https://${domain}`,
      attribution: 'Published jobs from configured Teamtailor career sites',
      defaultCompany: domain,
    }),
  );
  return multiTenantAdapter({
    id: 'teamtailor',
    name: 'Teamtailor',
    baseUrl: 'https://www.teamtailor.com',
    tenants: domains,
    discoverTenant: async (domain, signal) => {
      const feed = feeds[domains.indexOf(domain)];
      if (!feed) return [];
      return (await feed.discover({ ...(signal ? { signal } : {}) })).jobs;
    },
  });
};

const definition = (input: {
  id: string;
  name: string;
  baseUrl: string;
  values: readonly string[];
  adapter: (values: readonly string[]) => JobSourceAdapter;
  envName: string;
}): JobSourceDefinition => {
  if (input.values.length === 0) {
    return {
      id: input.id,
      name: input.name,
      baseUrl: input.baseUrl,
      strategy: 'DISABLED',
      enabledByDefault: false,
      disabledReason: `${input.envName} is empty; add at least one company career-board identifier.`,
    };
  }
  const adapter = input.adapter(input.values);
  return {
    id: adapter.id,
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    strategy: adapter.strategy,
    enabledByDefault: true,
    attribution: adapter.attribution,
    fetchIntervalMinutes: adapter.fetchIntervalMinutes,
    rateLimitPerMinute: adapter.rateLimitPerMinute,
    adapter,
  };
};

export const createConfiguredAtsDefinitions = (
  configuration: AtsSourceConfiguration,
): JobSourceDefinition[] => {
  const greenhouseBoards = parseIdentifiers(
    configuration.greenhouseBoards,
  ).filter((board) => board.toLowerCase() !== 'agoda');
  const leverSites = parseIdentifiers(configuration.leverSites);
  const ashbyBoards = parseIdentifiers(configuration.ashbyBoards);
  const smartRecruitersCompanies = parseIdentifiers(
    configuration.smartRecruitersCompanies,
  );
  const workableAccounts = parseIdentifiers(configuration.workableAccounts);
  const recruiteeCompanies = parseIdentifiers(configuration.recruiteeCompanies);
  const teamtailorDomains = [
    ...new Set(
      (configuration.teamtailorDomains ?? []).map((domain) =>
        domainSchema.parse(domain),
      ),
    ),
  ];
  return [
    definition({
      id: 'greenhouse',
      name: 'Greenhouse curated boards',
      baseUrl: 'https://www.greenhouse.com',
      values: greenhouseBoards,
      adapter: greenhouseAdapter,
      envName: 'JOBS_GREENHOUSE_BOARDS',
    }),
    definition({
      id: 'lever',
      name: 'Lever curated boards',
      baseUrl: 'https://www.lever.co',
      values: leverSites,
      adapter: leverAdapter,
      envName: 'JOBS_LEVER_SITES',
    }),
    definition({
      id: 'ashby',
      name: 'Ashby curated boards',
      baseUrl: 'https://www.ashbyhq.com',
      values: ashbyBoards,
      adapter: ashbyAdapter,
      envName: 'JOBS_ASHBY_BOARDS',
    }),
    definition({
      id: 'smartrecruiters',
      name: 'SmartRecruiters curated companies',
      baseUrl: 'https://www.smartrecruiters.com',
      values: smartRecruitersCompanies,
      adapter: smartRecruitersAdapter,
      envName: 'JOBS_SMARTRECRUITERS_COMPANIES',
    }),
    definition({
      id: 'workable',
      name: 'Workable curated companies',
      baseUrl: 'https://www.workable.com',
      values: workableAccounts,
      adapter: workableAdapter,
      envName: 'JOBS_WORKABLE_ACCOUNTS',
    }),
    definition({
      id: 'recruitee',
      name: 'Recruitee curated companies',
      baseUrl: 'https://recruitee.com',
      values: recruiteeCompanies,
      adapter: recruiteeAdapter,
      envName: 'JOBS_RECRUITEE_COMPANIES',
    }),
    definition({
      id: 'teamtailor',
      name: 'Teamtailor curated companies',
      baseUrl: 'https://www.teamtailor.com',
      values: teamtailorDomains,
      adapter: teamtailorAdapter,
      envName: 'JOBS_TEAMTAILOR_DOMAINS',
    }),
  ];
};
