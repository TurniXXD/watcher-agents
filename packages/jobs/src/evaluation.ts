import { normalizeText } from './normalization.js';
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

const explicitlyIncompatibleRemoteRegion = (value: string): boolean =>
  /\b(?:united states|u\.?s\.?a?|canada|north america|latin america|latam|south america|australia|new zealand|india|asia only)\b/iu.test(
    value,
  );

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
    if (evidence.some(explicitlyIncompatibleRemoteRegion))
      return { compatible: false, explicitBlocker: true, uncertain: false };
    return { compatible: false, explicitBlocker: false, uncertain: true };
  }

  if (job.workMode === 'HYBRID' && !profile.preferredLocations.hybrid)
    return { compatible: false, explicitBlocker: true, uncertain: false };
  if (job.workMode === 'ONSITE' && !profile.preferredLocations.onsite)
    return { compatible: false, explicitBlocker: true, uncertain: false };
  if (!location)
    return { compatible: false, explicitBlocker: false, uncertain: true };
  if (allowed(location))
    return { compatible: true, explicitBlocker: false, uncertain: false };
  return { compatible: false, explicitBlocker: false, uncertain: true };
};

export const evaluateJob = (
  job: NormalizedJob,
  profile: CandidateProfile,
): JobEvaluationResult => {
  const body = `${job.title}\n${job.description}`;
  const normalizedBody = normalizeText(body);
  const hardBlockers: string[] = [];
  const uncertainties: string[] = [];
  const geography = locationCompatibility(job, profile);

  if (mandatory(body, /\b(?:bachelor|master|phd|university degree|degree)\b/iu))
    hardBlockers.push('Mandatory degree requirement');
  if (mandatory(body, /\b(?:german|deutsch|french|fran[cç]ais)\b/iu))
    hardBlockers.push('Mandatory unsupported language');
  if (
    /\b(?:graduate programme|graduate program|new grad(?:uate)?|internship|intern)\b/iu.test(
      body,
    )
  )
    hardBlockers.push('Graduate-only or internship role');
  if (/\b(?:us only|united states only|canada only|latam only)\b/iu.test(body))
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
  if (!titleMatches(job.title, profile.preferredRoles))
    hardBlockers.push('Unrelated role');

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

  const yearsMatch = body.match(/(\d{1,2})\+?\s*(?:years?|yrs?)/iu);
  const requiredYears = yearsMatch ? Number(yearsMatch[1]) : undefined;
  const experienceRatio = requiredYears
    ? Math.min(1, profile.yearsExperience / Math.max(1, requiredYears))
    : 0.8;
  const roleRatio = titleMatches(job.title, profile.preferredRoles) ? 1 : 0;
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
