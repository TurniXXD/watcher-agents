import { normalizeText } from './normalization.js';
import { hasMandatoryComputerScienceDegree } from './requirements.js';
import type {
  CandidateProfile,
  JobEvaluationResult,
  NormalizedJob,
  Recommendation,
} from './types.js';

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
    return /required|must|mandatory|need(?:ed)?|minimum|fluent|proficien/iu.test(
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

const unsupportedLanguagePattern = new RegExp(
  String.raw`\b(?:${[
    ...twoLetterDisplayNames('language').filter(
      (language) => language !== 'english',
    ),
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
  ]
    .map(escapePattern)
    .join('|')})\b`,
  'iu',
);

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
): { compatible: boolean; explicitBlocker: boolean; uncertain: boolean } => {
  const allowedPlaces = [
    ...profile.preferredLocations.countries,
    ...profile.preferredLocations.regions,
    ...profile.preferredLocations.cities,
  ].map(normalizeText);
  const regionValues = job.remoteRegions.map(normalizeText);
  const location = normalizeText(job.location ?? '');
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
  return { compatible: true, explicitBlocker: false, uncertain: false };
};

export const evaluateJob = (
  job: NormalizedJob,
  profile: CandidateProfile,
): JobEvaluationResult => {
  const body = `${job.title}\n${job.description}`;
  const technologyEvidence = `${body}\n${job.technologyStack.join('\n')}`;
  const normalizedBody = normalizeText(body);
  const hardBlockers: string[] = [];
  const uncertainties: string[] = [];
  const geography = locationCompatibility(job, profile);
  const allowedPlaces = [
    ...profile.preferredLocations.countries,
    ...profile.preferredLocations.regions,
    ...profile.preferredLocations.cities,
  ].map(normalizeText);
  const requiredYears = requiredExperienceYears(body);
  const adjacentRole = titlePhraseMatches(job.title, profile.adjacentRoles);
  const matchedRequiredTechnologies = profile.requiredTechnologies.filter(
    (technology) => technologyPattern(technology).test(technologyEvidence),
  );
  const excludedTitleTechnologies = profile.excludedTechnologies.filter(
    (technology) => technologyPattern(technology).test(job.title),
  );
  const mandatoryExcludedTechnologies = profile.excludedTechnologies.filter(
    (technology) => mandatory(body, technologyPattern(technology)),
  );

  if (
    mandatory(body, /\b(?:bachelor|master|phd|university degree|degree)\b/iu) ||
    hasMandatoryComputerScienceDegree(body)
  )
    hardBlockers.push('Mandatory degree requirement');
  if (mandatory(body, unsupportedLanguagePattern))
    hardBlockers.push('Mandatory unsupported language');
  if (
    /\bstaff\b/iu.test(job.title) &&
    /\b(?:engineer|developer)\b/iu.test(job.title)
  )
    hardBlockers.push('Staff-level engineering role');
  if (requiredYears && requiredYears > profile.yearsExperience)
    hardBlockers.push(
      `Requires ${requiredYears} years of experience; profile has ${profile.yearsExperience}`,
    );
  if (
    /\b(?:graduate programme|graduate program|new grad(?:uate)?|internship|intern)\b/iu.test(
      body,
    )
  )
    hardBlockers.push('Graduate-only or internship role');
  if (explicitlyRestrictedGeography(body, allowedPlaces))
    hardBlockers.push('Incompatible geography');
  if (
    geography.explicitBlocker &&
    !hardBlockers.includes('Incompatible geography')
  )
    hardBlockers.push('Incompatible geography');
  if (
    profile.avoidedRoles.length > 0 &&
    titleMatches(job.title, profile.avoidedRoles)
  )
    hardBlockers.push('Explicitly avoided role');
  if (!titleMatches(job.title, profile.preferredRoles) && !adjacentRole)
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
    profile.requiredTechnologies.length > 0 &&
    matchedRequiredTechnologies.length === 0 &&
    !adjacentRole
  )
    hardBlockers.push('Missing required target technology');

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
  const roleRatio = titleMatches(job.title, profile.preferredRoles)
    ? 1
    : adjacentRole
      ? 0.9
      : 0;
  const technologyRatio = wantedJobSkills.length
    ? proportion(matchedWantedSkills.length, wantedJobSkills.length)
    : Math.min(1, matchingSkills.length / Math.min(5, skillNames.length));

  const scoreBreakdown = {
    role: profile.weights.role * roleRatio,
    technology: profile.weights.technology * technologyRatio,
    experience: profile.weights.experience * experienceRatio,
    location: profile.weights.location * (geography.compatible ? 1 : 0.4),
    language: profile.weights.language * 0.8,
    career: profile.weights.career * (roleRatio ? 0.9 : 0.3),
    conditions:
      profile.weights.conditions *
      (job.salaryMin || job.salaryMax || job.contractType ? 1 : 0.6),
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
