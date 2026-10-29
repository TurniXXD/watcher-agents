import { describe, expect, it } from 'vitest';
import { candidateProfileSchema } from '@watcher/jobs';
import {
  jobsCategoryUsage,
  renderJobsCategories,
  updateJobsCategory,
} from '../categories.js';

const profile = candidateProfileSchema.parse({
  name: 'Candidate',
  professionalTitle: 'Full-Stack Developer',
  yearsExperience: 5,
  educationLevel: 'Secondary technical school',
  languages: { Czech: 'native', English: 'B2' },
  preferredRoles: ['Full-Stack Developer'],
  preferredLocations: { countries: ['Czechia'] },
  skills: [{ name: 'TypeScript', proficiency: 'ADVANCED' }],
});

describe('Jobs Bot search categories', () => {
  it('enables and disables the additive sales category without changing the technical profile', () => {
    const enabled = updateJobsCategory(profile, 'sales on');
    expect(enabled.searchCategories.salesBusinessDevelopment).toBe(true);
    expect(enabled.professionalTitle).toBe(profile.professionalTitle);
    expect(enabled.preferredRoles).toEqual(profile.preferredRoles);

    const disabled = updateJobsCategory(enabled, 'sales off');
    expect(disabled.searchCategories.salesBusinessDevelopment).toBe(false);
    expect(renderJobsCategories(disabled)).toContain('technical: enabled');
    expect(renderJobsCategories(disabled)).toContain('sales: disabled');
  });

  it.each(['', 'technical off', 'sales maybe', 'sales on extra'])(
    'rejects invalid syntax: %s',
    (argument) => {
      expect(() => updateJobsCategory(profile, argument)).toThrow(
        jobsCategoryUsage,
      );
    },
  );
});
