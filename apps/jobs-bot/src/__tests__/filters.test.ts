import {
  candidateProfileSchema,
  evaluateJob,
  normalizedJobSchema,
} from '@watcher/jobs';
import { describe, expect, it } from 'vitest';
import { renderJobsFilters, updateJobsFilter } from '../filters.js';

const profile = candidateProfileSchema.parse({
  name: 'Candidate',
  professionalTitle: 'Full-Stack Developer',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school',
  languages: { English: 'B2' },
  preferredRoles: ['Full-Stack Developer'],
  avoidedRoles: [],
  requiredTechnologies: ['TypeScript'],
  excludedTechnologies: ['Python'],
  adjacentRoles: [],
  preferredLocations: {
    countries: ['Czechia'],
    regions: ['Europe'],
    cities: ['Prague'],
    remote: true,
    hybrid: false,
    onsite: true,
  },
  skills: [{ name: 'TypeScript', proficiency: 'ADVANCED' }],
});

const job = normalizedJobSchema.parse({
  externalId: '1',
  sourceId: 'fixture',
  title: 'Full-Stack TypeScript Developer',
  company: 'Example',
  description: 'Build software in TypeScript.',
  location: 'Prague, Czechia',
  workMode: 'ONSITE',
  technologyStack: ['TypeScript'],
  originalUrl: 'https://example.com/jobs/1',
  raw: {},
});

describe('editable job filters', () => {
  it('initializes from the current candidate preferences', () => {
    expect(renderJobsFilters(profile)).toContain('technology block: Python');
    expect(renderJobsFilters(profile)).toContain('max_years: 5');
  });

  it('applies allowlists, blocklists and scalar rules', () => {
    let edited = updateJobsFilter(profile, 'keyword block add TypeScript');
    expect(evaluateJob(job, edited).hardBlockers).toContain('Blocked keyword');
    edited = updateJobsFilter(edited, 'keyword block remove TypeScript');
    expect(evaluateJob(job, edited).hardBlockers).not.toContain(
      'Blocked keyword',
    );
    edited = updateJobsFilter(edited, 'country block add Czechia');
    expect(evaluateJob(job, edited).hardBlockers).toContain('Blocked country');
    edited = updateJobsFilter(edited, 'country block clear');
    expect(evaluateJob(job, edited).hardBlockers).not.toContain(
      'Blocked country',
    );
    edited = updateJobsFilter(edited, 'degree off');
    expect(edited.filters?.blockMandatoryDegree).toBe(false);
    edited = updateJobsFilter(edited, 'max_years 7');
    expect(edited.filters?.maxRequiredExperienceYears).toBe(7);
  });

  it('rejects invalid category, action and empty values', () => {
    expect(() => updateJobsFilter(profile, 'salary allow add 100')).toThrow();
    expect(() => updateJobsFilter(profile, 'title allow add')).toThrow();
    expect(() => updateJobsFilter(profile, 'max_years -1')).toThrow();
  });
});
