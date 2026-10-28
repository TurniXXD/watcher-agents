import { normalizeText } from './normalization.js';
import { hasMandatoryComputerScienceDegree } from './requirements.js';
import type {
  CandidateProfile,
  JobFilters,
  JobEvaluationResult,
  NormalizedJob,
  Recommendation,
} from './types.js';
import { resolveJobFilters } from './types.js';

const includesPhrase = (text: string, phrase: string): boolean =>
  ` ${normalizeText(text)} `.includes(` ${normalizeText(phrase)} `);

const mandatory = (text: string, subject: RegExp): boolean => {
  const sentences = text.split(/[.!?\n]+/u);
  return sentences.some((sentence) => {
    const hasSubject = subject.test(sentence);
    if (!hasSubject) return false;
    if (
      /preferred|advantage|nice to have|plus|equivalent experience/iu.test(
        sentence,
      )
    )
      return false;
    return /required|must|mandatory|need(?:ed)?|minimum|fluent|proficien|strong|expert(?:ise)?/iu.test(
      sentence,
    );
  });
};

const titleMatches = (title: string, roles: string[]): boolean => {
  const normalized = normalizeText(title);
  return roles.some((role) => {
    const tokens = normalizeText(role)
      .split(' ')
      .filter((token) => token.length > 2);
    return tokens.some((token) => normalized.includes(token));
  });
};

const titlePhraseMatches = (title: string, roles: string[]): boolean => {
  const normalized = normalizeText(title);
  return roles.some((role) => normalized.includes(normalizeText(role)));
};

const allowedTitleMatches = (
  title: string,
  profile: CandidateProfile,
  filters: JobFilters,
): boolean =>
  profile.filters
    ? titlePhraseMatches(title, filters.title.allow)
    : titleMatches(title, filters.title.allow);

const technologyPattern = (technology: string): RegExp => {
  const normalized = normalizeText(technology);
  const patterns: Record<string, string> = {
    'c++': String.raw`c\+\+`,
    '.net': String.raw`(?:\.net|dotnet|c#)`,
    go: String.raw`(?:go|golang)`,
    java: String.raw`java(?!script)`,
    'next.js': String.raw`next(?:\.js|js)?`,
    'node.js': String.raw`node(?:\.js|js)?`,
    'react.js': String.raw`react(?:\.js|js)?`,
  };
  const source =
    patterns[normalized] ??
    normalized.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return new RegExp(String.raw`(?<![a-z0-9])(?:${source})(?![a-z0-9])`, 'iu');
};

const recommendationFor = (
  score: number,
  profile: CandidateProfile,
): Recommendation => {
  if (score >= profile.thresholds.excellent) return 'EXCELLENT';
  if (score >= profile.thresholds.strong) return 'STRONG';
  if (score >= profile.thresholds.possible) return 'POSSIBLE';
  return 'LOW';
};

const proportion = (matched: number, total: number): number =>
  total === 0 ? 1 : matched / total;

const twoLetterDisplayNames = (type: 'language' | 'region'): string[] => {
  const displayNames = new Intl.DisplayNames(['en'], { type });
  const names = new Set<string>();
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = displayNames.of(code);
      if (name && name !== code && !name.startsWith('Unknown '))
        names.add(normalizeText(name));
    }
  }
  return [...names];
};

const escapePattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

const knownLanguages = [
  ...twoLetterDisplayNames('language'),
  'deutsch',
  'français',
  'español',
  'čeština',
  'slovenčina',
  'polski',
  'italiano',
  'nederlands',
  'português',
  'mandarin',
];

const unsupportedLanguagePattern = (filters: JobFilters): RegExp => {
  const unsupportedLanguages = [
    ...(filters.language.allow.length > 0
      ? knownLanguages.filter(
          (language) =>
            !filters.language.allow.some(
              (allowed) => normalizeText(allowed) === normalizeText(language),
            ),
        )
      : []),
    ...filters.language.block,
  ];

  return unsupportedLanguages.length > 0
    ? new RegExp(
        String.raw`\b(?:${unsupportedLanguages.map(escapePattern).join('|')})\b`,
        'iu',
      )
    : /$(?!)/u;
};

const countryNames = (() => {
  const names = new Set(twoLetterDisplayNames('region'));
  ['USA', 'US', 'UK', 'UAE'].forEach((name) => names.add(normalizeText(name)));
  return [...names];
})();

const explicitlyRestrictedGeography = (
  text: string,
  allowedPlaces: readonly string[],
): boolean =>
  text.split(/[.!?\n]+/u).some((sentence) => {
    const normalized = normalizeText(sentence);
    const hasResidenceRestriction =
      /\b(?:must (?:be )?(?:based|located|resident|reside|live)|required to (?:be based|reside|live)|candidates? (?:must )?(?:be )?(?:based|located|resident) in|applicants? (?:must )?(?:be )?(?:based|located|resident) in|remote (?:from|in|within))\b/iu.test(
        normalized,
      );
    const hasCountryOnlyRestriction =
      normalized.includes(' only') &&
      countryNames.some((country) => normalized.includes(`${country} only`));
    if (!hasResidenceRestriction && !hasCountryOnlyRestriction) return false;
    if (
      /\b(?:worldwide|anywhere|global|europe|european union|eu)\b/iu.test(
        normalized,
      ) ||
      allowedPlaces.some(
        (place) => normalized.includes(place) || place.includes(normalized),
      )
    )
      return false;
    return true;
  });

const requiredExperienceYears = (text: string): number | undefined => {
  const requirements = text
    .split(/[.!?\n]+/u)
    .filter(
      (sentence) =>
        !/preferred|advantage|nice to have|bonus|up to|equivalent experience/iu.test(
          sentence,
        ),
    )
    .flatMap((sentence) => {
      const years = [
        ...sentence.matchAll(
          /\b(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\+?\s*(?:years?|yrs?)(?:\s+of)?\b/giu,
        ),
      ];
      if (years.length === 0) return [];
      const requirementContext =
        /experience|professional|commercial|software development|engineering|building|developing|minimum|at least|required|must|need|looking for|you have|you bring/iu.test(
          sentence,
        );
      if (!requirementContext) return [];
      return years
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value));
    });
  return requirements.length > 0 ? Math.max(...requirements) : undefined;
};

const locationCompatibility = (
  job: NormalizedJob,
  profile: CandidateProfile,
  filters: JobFilters,
): { compatible: boolean; explicitBlocker: boolean; uncertain: boolean } => {
  const allowedPlaces = [
    ...filters.country.allow,
    ...profile.preferredLocations.regions,
    ...profile.preferredLocations.cities,
  ].map(normalizeText);
  const unrestrictedCountries = filters.country.allow.length === 0;
  const regionValues = job.remoteRegions.map(normalizeText);
  const location = normalizeText(job.location ?? '');
  const country = normalizeText(job.country ?? '');
  const allowed = (value: string): boolean =>
    Boolean(value) &&
    (allowedPlaces.some(
      (place) => value.includes(place) || place.includes(value),
    ) ||
      /\b(?:worldwide|anywhere|global)\b/iu.test(value));

  if (job.workMode === 'REMOTE') {
    if (!profile.preferredLocations.remote)
      return { compatible: false, explicitBlocker: true, uncertain: false };
    const evidence =
      regionValues.length > 0 ? regionValues : [location].filter(Boolean);
    const allowedCountries = filters.country.allow.map(normalizeText);
    const structuredCountryValues = [
      ...regionValues.filter((value) => countryNames.includes(value)),
      ...(country ? [country] : []),
      ...countryNames.filter(
        (countryName) =>
          location === countryName ||
          location.endsWith(` ${countryName}`) ||
          location.includes(`, ${countryName}`),
      ),
    ];
    const hasIncompatibleSpecificCountry = structuredCountryValues.some(
      (value) =>
        !allowedCountries.some(
          (country) => value.includes(country) || country.includes(value),
        ),
    );
    if (hasIncompatibleSpecificCountry && !unrestrictedCountries)
      return { compatible: false, explicitBlocker: true, uncertain: false };
    if (unrestrictedCountries)
      return {
        compatible: evidence.length > 0,
        explicitBlocker: false,
        uncertain: evidence.length === 0,
      };
    if (evidence.some(allowed))
      return { compatible: true, explicitBlocker: false, uncertain: false };
    if (regionValues.length > 0 && evidence.some((value) => !allowed(value)))
      return { compatible: false, explicitBlocker: true, uncertain: false };
    return { compatible: false, explicitBlocker: false, uncertain: true };
  }

  if (job.workMode === 'HYBRID' && !profile.preferredLocations.hybrid)
    return { compatible: false, explicitBlocker: true, uncertain: false };
  if (job.workMode === 'ONSITE' && !profile.preferredLocations.onsite)
    return { compatible: false, explicitBlocker: true, uncertain: false };
  if (!location)
    return { compatible: false, explicitBlocker: false, uncertain: true };
  if (unrestrictedCountries)
    return { compatible: true, explicitBlocker: false, uncertain: false };
  const allowedLocalPlaces = [
    ...filters.country.allow,
    ...profile.preferredLocations.cities,
  ].map(normalizeText);
  const localEvidence = country || location;
  return allowedLocalPlaces.some(
    (place) =>
      localEvidence.includes(place) ||
      place.includes(localEvidence) ||
      location.includes(place),
  )
    ? { compatible: true, explicitBlocker: false, uncertain: false }
    : { compatible: false, explicitBlocker: true, uncertain: false };
};

export const evaluateJob = (
  job: NormalizedJob,
  profile: CandidateProfile,
): JobEvaluationResult => {
  const filters = resolveJobFilters(profile);
  const body = `${job.title}\n${job.description}`;
  const technologyEvidence = `${body}\n${job.technologyStack.join('\n')}`;
  const normalizedBody = normalizeText(body);
  const hardBlockers: string[] = [];
  const uncertainties: string[] = [];
  const geography = locationCompatibility(job, profile, filters);
  const allowedPlaces = [
    ...filters.country.allow,
    ...profile.preferredLocations.regions,
    ...profile.preferredLocations.cities,
  ].map(normalizeText);
  const requiredYears = requiredExperienceYears(body);
  const adjacentRole = titlePhraseMatches(job.title, profile.adjacentRoles);
  const matchedRequiredTechnologies = filters.technology.allow.filter(
    (technology) => technologyPattern(technology).test(technologyEvidence),
  );
  const excludedTitleTechnologies = filters.technology.block.filter(
    (technology) => technologyPattern(technology).test(job.title),
  );
  const mandatoryExcludedTechnologies = filters.technology.block.filter(
    (technology) => mandatory(body, technologyPattern(technology)),
  );

  if (
    filters.blockMandatoryDegree &&
    (mandatory(
      body,
      /\b(?:bachelor|master|phd|university degree|degree)\b/iu,
    ) ||
      hasMandatoryComputerScienceDegree(body))
  )
    hardBlockers.push('Mandatory degree requirement');
  if (mandatory(body, unsupportedLanguagePattern(filters)))
    hardBlockers.push('Mandatory unsupported language');
  if (
    filters.blockStaffEngineering &&
    /\bstaff\b/iu.test(job.title) &&
    /\b(?:engineer|developer)\b/iu.test(job.title)
  )
    hardBlockers.push('Staff-level engineering role');
  if (requiredYears && requiredYears > filters.maxRequiredExperienceYears)
    hardBlockers.push(
      `Requires ${requiredYears} years of experience; filter maximum is ${filters.maxRequiredExperienceYears}`,
    );
  if (
    /\b(?:graduate programme|graduate program|new grad(?:uate)?|internship|intern)\b/iu.test(
      body,
    )
  )
    hardBlockers.push('Graduate-only or internship role');
  if (
    filters.country.allow.length > 0 &&
    explicitlyRestrictedGeography(body, allowedPlaces)
  )
    hardBlockers.push('Incompatible geography');
  if (
    geography.explicitBlocker &&
    !hardBlockers.includes('Incompatible geography')
  )
    hardBlockers.push('Incompatible geography');
  if (
    filters.country.block.some((country) =>
      [job.country, job.location, ...job.remoteRegions].some(
        (value) => value && includesPhrase(value, country),
      ),
    )
  )
    hardBlockers.push('Blocked country');
  if (
    filters.title.block.length > 0 &&
    titlePhraseMatches(job.title, filters.title.block)
  )
    hardBlockers.push('Explicitly avoided role');
  if (
    filters.title.allow.length > 0 &&
    !allowedTitleMatches(job.title, profile, filters)
  )
    hardBlockers.push('Unrelated role');
  if (excludedTitleTechnologies.length > 0)
    hardBlockers.push(
      `Excluded technology role: ${excludedTitleTechnologies.join(', ')}`,
    );
  else if (mandatoryExcludedTechnologies.length > 0)
    hardBlockers.push(
      `Mandatory excluded technology: ${mandatoryExcludedTechnologies.join(', ')}`,
    );
  if (
    filters.technology.allow.length > 0 &&
    matchedRequiredTechnologies.length === 0 &&
    !adjacentRole
  )
    hardBlockers.push('Missing required target technology');
  if (filters.keyword.block.some((keyword) => includesPhrase(body, keyword)))
    hardBlockers.push('Blocked keyword');
  if (
    filters.keyword.allow.length > 0 &&
    !filters.keyword.allow.some((keyword) => includesPhrase(body, keyword))
  )
    hardBlockers.push('Missing required keyword');

  if (
    mandatory(body, /\benglish\b/iu) &&
    /\b(?:c1|c2|fluent|native)\b/iu.test(body)
  )
    uncertainties.push('English proficiency level needs confirmation');
  if (geography.uncertain)
    uncertainties.push('Location eligibility is not explicit');
  if (/security clearance|right to work|work authorization/iu.test(body))
    uncertainties.push('Work authorization requirements need confirmation');

  const skillNames = profile.skills.map((skill) => skill.name);
  const matchingSkills = skillNames.filter((skill) =>
    normalizedBody.includes(normalizeText(skill)),
  );
  const missingSkills = job.technologyStack.filter(
    (skill) =>
      !skillNames.some(
        (candidateSkill) =>
          normalizeText(candidateSkill) === normalizeText(skill),
      ),
  );
  const wantedJobSkills = job.technologyStack;
  const matchedWantedSkills = wantedJobSkills.filter((skill) =>
    skillNames.some(
      (candidateSkill) =>
        normalizeText(candidateSkill) === normalizeText(skill),
    ),
  );

  const experienceRatio = requiredYears
    ? Math.min(1, profile.yearsExperience / Math.max(1, requiredYears))
    : 0.8;
  const roleRatio =
    filters.title.allow.length === 0 ||
    allowedTitleMatches(job.title, profile, filters)
      ? 1
      : adjacentRole
        ? 0.9
        : 0;
  const technologyRatio = wantedJobSkills.length
    ? proportion(matchedWantedSkills.length, wantedJobSkills.length)
    : Math.min(1, matchingSkills.length / Math.min(5, skillNames.length));
  const preferredContract = Boolean(
    job.contractType &&
    profile.preferredContractTypes.some((contractType) =>
      normalizeText(job.contractType ?? '').includes(
        normalizeText(contractType),
      ),
    ),
  );
  const locationRatio = geography.compatible
    ? job.workMode === 'REMOTE'
      ? 1
      : 0.75
    : 0.4;

  const scoreBreakdown = {
    role: profile.weights.role * roleRatio,
    technology: profile.weights.technology * technologyRatio,
    experience: profile.weights.experience * experienceRatio,
    location: profile.weights.location * locationRatio,
    language: profile.weights.language * 0.8,
    career: profile.weights.career * (roleRatio ? 0.9 : 0.3),
    conditions:
      profile.weights.conditions *
      (preferredContract
        ? 1
        : job.salaryMin || job.salaryMax || job.contractType
          ? 0.75
          : 0.5),
  };
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
      ),
    ),
  );
  const eligibility =
    hardBlockers.length > 0
      ? 'INELIGIBLE'
      : uncertainties.length > 0
        ? 'UNCERTAIN'
        : 'ELIGIBLE';
  const recommendation = recommendationFor(score, profile);
  const reasoning = hardBlockers.length
    ? `Rejected: ${hardBlockers.join('; ')}.`
    : `${matchingSkills.length} profile skills matched; recommendation ${recommendation.toLowerCase()}.`;

  return {
    score,
    eligibility,
    recommendation,
    matchingSkills,
    missingSkills,
    hardBlockers,
    uncertainties,
    reasoning,
    scoreBreakdown,
  };
};
