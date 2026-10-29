import { candidateProfileSchema, type CandidateProfile } from '@watcher/jobs';

export const jobsCategoryUsage =
  'Usage: /jobs_category [list | sales on|off]. The technical search remains enabled; Sales & Business Development is additive.';

export const renderJobsCategories = (profile: CandidateProfile): string =>
  [
    'Job search categories:',
    'technical: enabled (existing profile and scoring)',
    `sales: ${profile.searchCategories.salesBusinessDevelopment ? 'enabled' : 'disabled'} (separate career-transition profile)`,
  ].join('\n');

export const updateJobsCategory = (
  profile: CandidateProfile,
  argument: string,
): CandidateProfile => {
  const [category = '', state = '', ...rest] = argument.trim().split(/\s+/u);
  if (
    category !== 'sales' ||
    (state !== 'on' && state !== 'off') ||
    rest.length > 0
  )
    throw new Error(jobsCategoryUsage);

  return candidateProfileSchema.parse({
    ...profile,
    searchCategories: {
      ...profile.searchCategories,
      salesBusinessDevelopment: state === 'on',
    },
  });
};
