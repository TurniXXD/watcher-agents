import {
  candidateProfileSchema,
  jobFiltersSchema,
  resolveJobFilters,
  type CandidateProfile,
} from '@watcher/jobs';

const categories = [
  'title',
  'country',
  'technology',
  'keyword',
  'language',
] as const;
type Category = (typeof categories)[number];

const isCategory = (value: string): value is Category =>
  categories.some((category) => category === value);

export const jobsFilterUsage =
  'Usage: /jobs_filter [list | CATEGORY allow|block add|remove|clear VALUE | max_years NUMBER | degree on|off | staff on|off]. Categories: title, country, technology, keyword, language.';

export const renderJobsFilters = (profile: CandidateProfile): string => {
  const filters = resolveJobFilters(profile);
  return [
    'Editable job filters (allow = whitelist, block = blacklist):',
    ...categories.flatMap((category) => [
      `${category} allow: ${filters[category].allow.join(', ') || '(any)'}`,
      `${category} block: ${filters[category].block.join(', ') || '(none)'}`,
    ]),
    `max_years: ${filters.maxRequiredExperienceYears}`,
    `degree: ${filters.blockMandatoryDegree ? 'on' : 'off'} (block mandatory degree)`,
    `staff: ${filters.blockStaffEngineering ? 'on' : 'off'} (block Staff Engineer/Developer)`,
    'Blocklists override allowlists. An empty allowlist accepts any value in that category.',
  ].join('\n');
};

export const updateJobsFilter = (
  profile: CandidateProfile,
  argument: string,
): CandidateProfile => {
  const filters = structuredClone(resolveJobFilters(profile));
  const [category = '', side = '', action = '', ...rest] = argument
    .trim()
    .split(/\s+/u);
  if (category === 'max_years') {
    if (!/^\d{1,2}$/u.test(side) || action || rest.length)
      throw new Error(jobsFilterUsage);
    filters.maxRequiredExperienceYears = Number(side);
  } else if (category === 'degree' || category === 'staff') {
    if (!['on', 'off'].includes(side) || action || rest.length)
      throw new Error(jobsFilterUsage);
    if (category === 'degree') filters.blockMandatoryDegree = side === 'on';
    else filters.blockStaffEngineering = side === 'on';
  } else if (isCategory(category)) {
    if (side !== 'allow' && side !== 'block') throw new Error(jobsFilterUsage);
    if (!['add', 'remove', 'clear'].includes(action))
      throw new Error(jobsFilterUsage);
    const value = rest.join(' ').trim();
    if (action === 'clear') {
      if (value) throw new Error(jobsFilterUsage);
      filters[category][side] = [];
    } else {
      if (!value || value.length > 100) throw new Error(jobsFilterUsage);
      const previous = filters[category][side];
      filters[category][side] =
        action === 'add'
          ? previous.some((item) => item.toLowerCase() === value.toLowerCase())
            ? previous
            : [...previous, value]
          : previous.filter(
              (item) => item.toLowerCase() !== value.toLowerCase(),
            );
    }
  } else {
    throw new Error(jobsFilterUsage);
  }
  return candidateProfileSchema.parse({
    ...profile,
    filters: jobFiltersSchema.parse(filters),
  });
};
