import { describe, expect, it } from 'vitest';
import {
  candidateProfileSchema,
  evaluateSalesBusinessJob,
  isSalesBusinessDevelopmentJob,
  normalizedJobSchema,
} from '../index.js';

const profile = candidateProfileSchema.parse({
  name: 'Career transition candidate',
  professionalTitle: 'Full-Stack Developer and startup co-founder',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school',
  languages: { Czech: 'native', English: 'B2' },
  preferredRoles: ['Full-Stack Developer'],
  preferredContractTypes: ['IČO', 'B2B', 'contractor', 'employment'],
  preferredLocations: {
    countries: ['Czechia', 'Czech Republic'],
    regions: ['Europe'],
    cities: ['Brno'],
    remote: true,
    hybrid: false,
    onsite: true,
  },
  skills: ['TypeScript', 'SaaS', 'Automation'].map((name) => ({
    name,
    proficiency: 'ADVANCED',
  })),
  experience: [
    {
      organization: 'Revizio',
      title: 'Full-Stack Developer and Co-Founder',
      period: '2023–2025',
      technologies: ['TypeScript'],
      highlights: ['Product development and validation'],
    },
  ],
  searchCategories: {
    salesBusinessDevelopment: true,
  },
});

const job = (title: string, description: string, overrides = {}) =>
  normalizedJobSchema.parse({
    externalId: 'sales-1',
    sourceId: 'fixture',
    title,
    company: 'Example SaaS',
    description,
    location: 'Brno, Czechia',
    country: 'Czechia',
    city: 'Brno',
    workMode: 'ONSITE',
    remoteRegions: [],
    technologyStack: [],
    originalUrl: 'https://example.com/jobs/sales-1',
    raw: {},
    ...overrides,
  });

describe('Sales & Business Development evaluation', () => {
  it('recognizes the supported English and Czech role families', () => {
    expect(
      isSalesBusinessDevelopmentJob(
        job('Junior Account Manager', 'Work with clients.'),
      ),
    ).toBe(true);
    expect(
      isSalesBusinessDevelopmentJob(
        job('Obchodní konzultant', 'Komunikace s klienty.'),
      ),
    ).toBe(true);
    expect(
      isSalesBusinessDevelopmentJob(
        job('Senior Software Engineer', 'Build software.'),
      ),
    ).toBe(false);
  });

  it('rewards beginner-friendly B2B SaaS training without inventing sales experience', () => {
    const result = evaluateSalesBusinessJob(
      job(
        'Business Development Representative',
        'Entry-level B2B SaaS role suitable for candidates without previous sales experience. Structured onboarding, mentoring and a fixed base salary plus performance bonus. Technical startup experience is an advantage.',
      ),
      profile,
    );

    expect(result.eligibility).toBe('ELIGIBLE');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.matchingSkills).toEqual(
      expect.arrayContaining([
        'Career transition explicitly welcomed',
        'Structured onboarding or training',
        'Technical/startup background advantage',
      ]),
    );
    expect(result.reasoning).toContain('Sales model: B2B');
    expect(result.reasoning).toContain('fixed salary');
    expect(result.reasoning).toContain('performance bonus');
    expect(result.reasoning).toContain(
      'No professional sales achievements, revenue targets, or managed client portfolio were assumed',
    );
  });

  it('rejects mandatory professional sales experience for the transition profile', () => {
    const result = evaluateSalesBusinessJob(
      job(
        'Account Manager',
        'Previous professional account management experience is required. Manage an existing client portfolio.',
      ),
      profile,
    );
    expect(result.hardBlockers).toContain(
      'Requires previous professional sales experience',
    );
    expect(result.eligibility).toBe('INELIGIBLE');
  });

  it('recognizes mandatory Czech commercial experience and senior sales titles', () => {
    const requiredExperience = evaluateSalesBusinessJob(
      job(
        'Klientský poradce',
        'Požadujeme předchozí praxi v obchodě jako nutnou podmínku.',
      ),
      profile,
    );
    expect(requiredExperience.hardBlockers).toContain(
      'Requires previous professional sales experience',
    );

    const senior = evaluateSalesBusinessJob(
      job('Senior Account Manager', 'Manage customer relationships.'),
      profile,
    );
    expect(senior.hardBlockers).toContain(
      'Senior sales role is not suitable for this career transition',
    );
  });

  it('allows general professional-experience requirements when sales experience is not required', () => {
    const result = evaluateSalesBusinessJob(
      job(
        'Business Development Specialist',
        'Three years of general professional experience required. Prior sales experience is not required. We value startup product validation and client communication.',
      ),
      profile,
    );
    expect(result.hardBlockers).not.toContain(
      'Requires previous professional sales experience',
    );
    expect(result.hardBlockers).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Requires 3 years/u)]),
    );
    expect(result.matchingSkills).toContain(
      'Client acquisition or relationship-building focus',
    );
  });

  it('rewards an explicit no-sales-experience requirement without needing an entry-level label', () => {
    const result = evaluateSalesBusinessJob(
      job(
        'Account Manager',
        'No previous professional sales experience is required. You will communicate with business clients.',
      ),
      profile,
    );
    expect(result.hardBlockers).not.toContain(
      'Requires previous professional sales experience',
    );
    expect(result.matchingSkills).toContain(
      'Career transition explicitly welcomed',
    );
  });

  it('flags rather than silently accepting commission-only financial advisory', () => {
    const result = evaluateSalesBusinessJob(
      job(
        'Financial Consultant',
        'Advise retail clients. Compensation is 100% commission. Build your own team and recruit new advisors. Advertised earnings 40,000–200,000 CZK.',
        { salaryMin: 40_000, salaryMax: 200_000, salaryCurrency: 'CZK' },
      ),
      profile,
    );
    expect(result.hardBlockers).toContain(
      'MLM-like recruitment or team-building structure',
    );
    expect(result.uncertainties).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Commission-only'),
        expect.stringContaining('unusually wide'),
        expect.stringContaining('Financial advisory'),
      ]),
    );
    expect(result.reasoning).toContain('Sales model: B2C');
    expect(result.reasoning).toContain('commission only');
    expect(result.reasoning).toContain(
      'Business model: recruitment-led financial advisory',
    );
  });

  it('does not reject legitimate fixed-salary financial services', () => {
    const result = evaluateSalesBusinessJob(
      job(
        'Investment Consultant',
        'Junior client role with structured training and mentoring. Fixed base salary. Previous sales experience is not required.',
      ),
      profile,
    );
    expect(result.hardBlockers).not.toContain(
      'MLM-like recruitment or team-building structure',
    );
    expect(result.eligibility).not.toBe('INELIGIBLE');
    expect(result.reasoning).toContain(
      'Business model: financial services with fixed salary',
    );
  });

  it('keeps Czech remote geography but rejects foreign-only remote roles', () => {
    const result = evaluateSalesBusinessJob(
      job('Sales Development Representative', 'Remote in Romania only.', {
        location: 'Romania',
        country: 'Romania',
        city: undefined,
        workMode: 'REMOTE',
        remoteRegions: ['Romania'],
      }),
      profile,
    );
    expect(result.hardBlockers).toContain('Incompatible geography');
  });

  it('accepts Czech-wide remote roles but limits on-site roles to Brno', () => {
    const remote = evaluateSalesBusinessJob(
      job('Sales Consultant', 'Remote role in Czechia.', {
        location: 'Czechia',
        country: 'Czechia',
        city: undefined,
        workMode: 'REMOTE',
        remoteRegions: ['Czechia'],
      }),
      profile,
    );
    const onsite = evaluateSalesBusinessJob(
      job('Sales Consultant', 'Work from our Prague office.', {
        location: 'Prague, Czechia',
        country: 'Czechia',
        city: 'Prague',
        workMode: 'ONSITE',
      }),
      profile,
    );
    expect(remote.hardBlockers).not.toContain('Incompatible geography');
    expect(onsite.hardBlockers).toContain('Incompatible geography');
  });
});
