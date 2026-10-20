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

  it.each(['German B1 is mandatory.', 'You must have fluent French.'])(
    'rejects unsupported mandatory language: %s',
    (requirement) => {
      expect(evaluateJob(job(requirement), profile).hardBlockers).toContain(
        'Mandatory unsupported language',
      );
    },
  );

  it('does not reject optional German', () => {
    expect(
      evaluateJob(
        job('German is a nice to have. English B2 is required.'),
        profile,
      ).hardBlockers,
    ).not.toContain('Mandatory unsupported language');
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
});
