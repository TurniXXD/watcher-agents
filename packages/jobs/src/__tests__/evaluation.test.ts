import { describe, expect, it } from 'vitest';
import {
  candidateProfileSchema,
  evaluateJob,
  normalizedJobSchema,
} from '../index.js';

const profile = candidateProfileSchema.parse({
  name: 'Candidate',
  professionalTitle: 'Full-Stack Developer',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school',
  languages: { Czech: 'native', English: 'B2' },
  preferredRoles: [
    'Full-Stack Developer',
    'React Engineer',
    'Node.js Developer',
  ],
  avoidedRoles: ['Helpdesk', 'Recruiter'],
  requiredTechnologies: ['Next.js', 'React.js', 'Node.js', 'TypeScript'],
  excludedTechnologies: ['PHP', 'Java', 'C++', 'Go', '.NET', 'Svelte'],
  adjacentRoles: [
    'Forward Deployed Engineer',
    'Forward Deployed Project Manager',
  ],
  preferredLocations: {
    countries: ['Czechia', 'Switzerland'],
    regions: ['Europe', 'EU', 'Worldwide'],
    cities: ['Brno'],
    remote: true,
    hybrid: true,
    onsite: true,
  },
  skills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'].map((name) => ({
    name,
    proficiency: 'ADVANCED',
  })),
});

const job = (description: string, overrides: Record<string, unknown> = {}) =>
  normalizedJobSchema.parse({
    externalId: 'job-1',
    sourceId: 'fixture',
    title: 'Full-Stack TypeScript Developer',
    company: 'Example',
    description,
    location: 'Brno, Czechia',
    workMode: 'HYBRID',
    remoteRegions: ['Europe'],
    technologyStack: ['React', 'TypeScript', 'Node.js', 'Kubernetes'],
    originalUrl: 'https://example.com/jobs/1',
    raw: {},
    ...overrides,
  });

describe('deterministic job evaluation', () => {
  it('rejects an explicit mandatory university degree', () => {
    const result = evaluateJob(
      job('A bachelor degree is mandatory. React and TypeScript required.'),
      profile,
    );
    expect(result.eligibility).toBe('INELIGIBLE');
    expect(result.hardBlockers).toContain('Mandatory degree requirement');
  });

  it('accepts degree-or-equivalent and preferred degree wording', () => {
    const result = evaluateJob(
      job(
        'Bachelor degree or equivalent experience accepted. Degree preferred.',
      ),
      profile,
    );
    expect(result.hardBlockers).not.toContain('Mandatory degree requirement');
  });

  it.each([
    'German B1 is mandatory.',
    'You must have fluent French.',
    'Professional Spanish is required.',
    'Polish proficiency is mandatory.',
    'Thai proficiency is mandatory.',
  ])('rejects unsupported mandatory language: %s', (requirement) => {
    expect(evaluateJob(job(requirement), profile).hardBlockers).toContain(
      'Mandatory unsupported language',
    );
  });

  it('does not reject optional German', () => {
    expect(
      evaluateJob(
        job('German is a nice to have. English B2 is required.'),
        profile,
      ).hardBlockers,
    ).not.toContain('Mandatory unsupported language');
  });

  it('does not reject a role requiring only English', () => {
    const result = evaluateJob(job('English B2 is required.'), profile);
    expect(result.hardBlockers).not.toContain('Mandatory unsupported language');
  });

  it.each(['Staff Software Engineer', 'Software Engineer, Staff'])(
    'rejects staff software engineering title: %s',
    (title) => {
      const result = evaluateJob(
        job('Build React and TypeScript products.', { title }),
        profile,
      );
      expect(result.hardBlockers).toContain('Staff-level engineering role');
    },
  );

  it.each([
    'At least 6 years of professional experience is required.',
    'You bring 7+ years of software development experience.',
    'Minimum 8–10 years of engineering experience.',
  ])('rejects experience requirements above the profile: %s', (requirement) => {
    const result = evaluateJob(job(requirement), profile);
    expect(result.hardBlockers).toContainEqual(
      expect.stringMatching(/^Requires [6-8] years of experience/u),
    );
  });

  it('allows five required years and ignores higher preferred experience', () => {
    const result = evaluateJob(
      job(
        'Five is not machine-readable. 5+ years of development experience required. 8 years preferred.',
      ),
      profile,
    );
    expect(result.hardBlockers).not.toContainEqual(
      expect.stringMatching(/^Requires \d+ years of experience/u),
    );
  });

  it('flags fluent English for review rather than rejecting it', () => {
    const result = evaluateJob(job('Fluent English is required.'), profile);
    expect(result.eligibility).toBe('UNCERTAIN');
    expect(result.uncertainties).toContain(
      'English proficiency level needs confirmation',
    );
  });

  it('rejects incompatible geography and graduate roles', () => {
    const result = evaluateJob(
      job('This new graduate program is available in the US only.'),
      profile,
    );
    expect(result.hardBlockers).toEqual(
      expect.arrayContaining([
        'Graduate-only or internship role',
        'Incompatible geography',
      ]),
    );
  });

  it('rejects a remote vacancy explicitly restricted outside Europe', () => {
    const result = evaluateJob(
      job('Remote role for the listed region.', {
        location: 'United States',
        workMode: 'REMOTE',
        remoteRegions: ['north-america'],
      }),
      profile,
    );
    expect(result.hardBlockers).toContain('Incompatible geography');
  });

  it.each([
    'This remote role is India only.',
    'This remote role is Portugal only.',
    'Applicants must be based in Japan.',
    'Applicants must be based in South Korea.',
    'Candidates located in the United States only.',
  ])('rejects a country-only restriction: %s', (description) => {
    const result = evaluateJob(
      job(description, {
        location: undefined,
        workMode: 'REMOTE',
        remoteRegions: [],
      }),
      profile,
    );
    expect(result.hardBlockers).toContain('Incompatible geography');
  });

  it('rejects any explicit structured remote region outside configured eligibility', () => {
    const result = evaluateJob(
      job('Work remotely with the product team.', {
        location: 'Portugal',
        workMode: 'REMOTE',
        remoteRegions: ['Portugal'],
      }),
      profile,
    );
    expect(result.hardBlockers).toContain('Incompatible geography');
  });

  it('accepts a foreign onsite role when it is not country-restricted', () => {
    const result = evaluateJob(
      job('The working language is English B2.', {
        location: 'Berlin, Germany',
        country: 'Germany',
        city: 'Berlin',
        workMode: 'ONSITE',
        remoteRegions: [],
      }),
      profile,
    );
    expect(result.hardBlockers).not.toContain('Incompatible geography');
    expect(result.uncertainties).not.toContain(
      'Location eligibility is not explicit',
    );
  });

  it('keeps remote eligibility uncertain when no permitted region is stated', () => {
    const result = evaluateJob(
      job('Work remotely with our distributed team.', {
        location: undefined,
        workMode: 'REMOTE',
        remoteRegions: [],
      }),
      profile,
    );
    expect(result.hardBlockers).not.toContain('Incompatible geography');
    expect(result.uncertainties).toContain(
      'Location eligibility is not explicit',
    );
  });

  it('scores a relevant stack and reports unknown technology as a gap', () => {
    const result = evaluateJob(
      job('Build React, TypeScript and Node.js services with PostgreSQL.'),
      profile,
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.matchingSkills).toEqual(
      expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'PostgreSQL']),
    );
    expect(result.missingSkills).toContain('Kubernetes');
  });

  it.each([
    ['Senior PHP Engineer', 'Build APIs in PHP.'],
    ['Java API Engineer', 'Java and Spring are required.'],
    ['C++ Engineer', 'Develop high-performance C++ services.'],
    ['Go Backend Engineer', 'Golang is required.'],
    ['Senior .NET Developer', 'Build services with C# and .NET.'],
    ['Svelte Developer', 'Develop the frontend in Svelte.'],
  ])('rejects excluded technology role %s', (title, description) => {
    const result = evaluateJob(job(description, { title }), profile);
    expect(result.eligibility).toBe('INELIGIBLE');
    expect(result.hardBlockers).toContainEqual(
      expect.stringMatching(/^Excluded technology role:/u),
    );
  });

  it('rejects a generic backend role without a target technology', () => {
    const result = evaluateJob(
      job('Build distributed backend services.', {
        title: 'Senior Backend Engineer',
        technologyStack: ['Kubernetes'],
      }),
      profile,
    );
    expect(result.hardBlockers).toContain('Missing required target technology');
  });

  it('accepts target technology supplied by structured stack metadata', () => {
    const result = evaluateJob(
      job('Build and maintain the product.', {
        title: 'Senior Backend Engineer',
        technologyStack: ['Node.js'],
      }),
      profile,
    );
    expect(result.hardBlockers).not.toContain(
      'Missing required target technology',
    );
  });

  it('allows an adjacent forward-deployed role without a target technology', () => {
    const result = evaluateJob(
      job('Lead customer deployments and coordinate technical delivery.', {
        title: 'Forward Deployed Project Manager',
        technologyStack: [],
      }),
      profile,
    );
    expect(result.hardBlockers).not.toContain(
      'Missing required target technology',
    );
    expect(result.hardBlockers).not.toContain('Unrelated role');
    expect(result.eligibility).toBe('ELIGIBLE');
  });
});
