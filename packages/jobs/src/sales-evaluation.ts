import { evaluateJob } from './evaluation.js';
import { normalizeText } from './normalization.js';
import {
  candidateProfileSchema,
  type CandidateProfile,
  type JobEvaluationResult,
  type NormalizedJob,
  type Recommendation,
} from './types.js';

const salesRoles = [
  'Relationship Manager',
  'Client Relationship Manager',
  'Account Manager',
  'Junior Account Manager',
  'Business Development Representative',
  'BDR',
  'Sales Development Representative',
  'SDR',
  'Business Development Specialist',
  'Sales Representative',
  'Sales Consultant',
  'Obchodní konzultant',
  'Obchodní zástupce',
  'Klientský poradce',
  'Financial Consultant',
  'Investment Consultant',
] as const;

const normalizedPhrase = (value: string): string => ` ${normalizeText(value)} `;

const titleContainsRole = (title: string, role: string): boolean =>
  normalizedPhrase(title).includes(normalizedPhrase(role));

const recommendationFor = (
  score: number,
  profile: CandidateProfile,
): Recommendation => {
  if (score >= profile.thresholds.excellent) return 'EXCELLENT';
  if (score >= profile.thresholds.strong) return 'STRONG';
  if (score >= profile.thresholds.possible) return 'POSSIBLE';
  return 'LOW';
};

export const isSalesBusinessDevelopmentJob = (job: NormalizedJob): boolean => {
  const title = job.title;
  return (
    salesRoles.some((role) => titleContainsRole(title, role)) ||
    /\b(?:business developer|sales specialist|sales executive|obchodník|obchodnice|péče o klienty|customer relationship)\b/iu.test(
      title,
    )
  );
};

export const buildSalesBusinessProfile = (
  base: CandidateProfile,
): CandidateProfile =>
  candidateProfileSchema.parse({
    ...base,
    professionalTitle:
      'Technical founder transitioning into sales and business development',
    summary:
      'Career-transition candidate with no professional sales, account-management, or financial-advisory employment. Co-founded Revizio and participated in product development and validation. Has strong software, SaaS, automation, and AI knowledge. Never infer sales targets, revenue achievements, or a managed client portfolio.',
    yearsExperience: base.yearsExperience,
    evaluationMode: 'SALES_BUSINESS',
    searchCategories: {
      salesBusinessDevelopment: true,
    },
    preferredRoles: [...salesRoles],
    avoidedRoles: [],
    requiredTechnologies: [],
    excludedTechnologies: [],
    adjacentRoles: [],
    preferredLocations: {
      countries: ['Czechia', 'Czech Republic'],
      regions: [],
      cities: ['Brno'],
      remote: true,
      hybrid: false,
      onsite: true,
    },
    filters: {
      title: { allow: [...salesRoles], block: [] },
      country: { allow: ['Czechia', 'Czech Republic'], block: [] },
      technology: { allow: [], block: [] },
      keyword: { allow: [], block: [] },
      language: { allow: ['Czech', 'English'], block: [] },
      maxRequiredExperienceYears: base.yearsExperience,
      blockMandatoryDegree: false,
      blockStaffEngineering: false,
    },
    skills: [
      ...base.skills,
      { name: 'Startup product validation', proficiency: 'INTERMEDIATE' },
      { name: 'SaaS products', proficiency: 'ADVANCED' },
      { name: 'Automation', proficiency: 'ADVANCED' },
      { name: 'Artificial intelligence', proficiency: 'ADVANCED' },
      { name: 'Technical discovery', proficiency: 'INTERMEDIATE' },
    ],
    weights: {
      technology: 0,
      experience: 20,
      role: 25,
      location: 20,
      language: 10,
      career: 15,
      conditions: 10,
    },
  });

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

export const evaluateSalesBusinessJob = (
  job: NormalizedJob,
  baseProfile: CandidateProfile,
): JobEvaluationResult => {
  const profile = buildSalesBusinessProfile(baseProfile);
  const initial = evaluateJob(job, profile);
  const text = `${job.title}\n${job.description}`;
  const hardBlockers = [...initial.hardBlockers];
  const uncertainties = [...initial.uncertainties];
  const matchingSkills = [...initial.matchingSkills];

  const welcomesBeginners = has(
    text,
    /without (?:previous |prior )?(?:professional )?(?:sales )?experience|no (?:previous |prior )?(?:professional )?(?:sales )?experience (?:is )?required|required experience is not necessary|entry[- ]level|junior|graduate|trainee|absolvent|bez (?:předchozí )?praxe|praxe není (?:nutná|podmínkou)|vhodné pro absolventy/iu,
  );
  const training = has(
    text,
    /onboarding|mentoring|mentor|training|academy|coaching|professional growth|career growth|zaškolení|školení|mentor|profesní růst|kariérní růst/iu,
  );
  const technicalAdvantage = has(
    text,
    /saas|software|technology|technical|automation|artificial intelligence|\bai\b|startup|product/iu,
  );
  const relationshipWork = has(
    text,
    /client communication|customer acquisition|relationship building|client relationships?|account development|komunikace s klient|akvizice zákazník|péče o klient|budování vztah/iu,
  );
  const requiredSalesExperience = text
    .split(/[.!?\n]+/u)
    .some(
      (sentence) =>
        /sales|business development|account management|relationship management|client relationships?|customer acquisition|financial advis|obchod|prodej|péč[ei] o klient|vztah[ůy] se zákazní/iu.test(
          sentence,
        ) &&
        /required|must|minimum|at least|proven track record|previous experience|praxe.*(?:nutná|podmínkou)|požadujeme.*praxi/iu.test(
          sentence,
        ) &&
        !/not required|not necessary|no (?:previous |prior )?(?:professional )?(?:sales )?experience (?:is )?required|without (?:previous |prior )?(?:professional )?(?:sales )?experience|není (?:nutná|podmínkou)|bez (?:předchozí )?praxe|výhodou|preferred|advantage/iu.test(
          sentence,
        ),
    );
  if (requiredSalesExperience)
    hardBlockers.push('Requires previous professional sales experience');

  const nonRemoteOutsideBrno =
    job.workMode !== 'REMOTE' &&
    !normalizeText(`${job.city ?? ''} ${job.location ?? ''}`).includes('brno');
  if (nonRemoteOutsideBrno) hardBlockers.push('Incompatible geography');

  if (/\b(?:senior|head of|director|ředitel|vedoucí)\b/iu.test(job.title))
    hardBlockers.push(
      'Senior sales role is not suitable for this career transition',
    );

  const b2b = has(
    text,
    /\bb2b\b|business[- ]to[- ]business|firemní klient|business clients?/iu,
  );
  const b2c = has(
    text,
    /\bb2c\b|business[- ]to[- ]consumer|retail clients?|koncov[ýí] zákazní/iu,
  );
  const commissionOnly = has(
    text,
    /commission[- ]only|solely commission|100\s*% commission|pouze proviz|čistě proviz/iu,
  );
  const commission = commissionOnly || has(text, /commission|proviz/iu);
  const fixedSalary = has(
    text,
    /fixed (?:salary|pay)|base salary|základní (?:mzda|plat)|fixní (?:mzda|plat|odměna)/iu,
  );
  const performanceBonus = has(
    text,
    /performance bonus|target bonus|bonus za výkon|výkonnostní bonus|odměn[ay].*výsled/iu,
  );
  const mlmLike = has(
    text,
    /multi[- ]level|network marketing|build your (?:own )?team|recruit.*(?:advisor|agent|consultant)|pasivní příjem|buduj.*tým/iu,
  );
  const financialAdvisory = has(
    text,
    /financial (?:advis|consult)|investment consult|finanční porad|investiční porad/iu,
  );
  const unclearCompensation =
    !fixedSalary &&
    !commission &&
    !performanceBonus &&
    !job.salaryMin &&
    !job.salaryMax;
  const misleadingSalary = Boolean(
    job.salaryMin &&
    job.salaryMax &&
    job.salaryMax >= Math.max(job.salaryMin * 2.5, job.salaryMin + 80_000),
  );

  if (commissionOnly)
    uncertainties.push(
      'Commission-only compensation; verify income risk and employment terms',
    );
  if (mlmLike)
    hardBlockers.push('MLM-like recruitment or team-building structure');
  if (unclearCompensation)
    uncertainties.push('Compensation structure is unclear');
  if (misleadingSalary)
    uncertainties.push(
      'Advertised salary range is unusually wide and needs verification',
    );
  if (financialAdvisory)
    uncertainties.push(
      commissionOnly || mlmLike
        ? 'Financial advisory appears primarily recruitment/commission driven'
        : 'Financial-services role: verify licensing, client acquisition model, and compensation',
    );

  if (welcomesBeginners)
    matchingSkills.push('Career transition explicitly welcomed');
  if (training) matchingSkills.push('Structured onboarding or training');
  if (technicalAdvantage)
    matchingSkills.push('Technical/startup background advantage');
  if (relationshipWork)
    matchingSkills.push('Client acquisition or relationship-building focus');

  const bonus =
    (welcomesBeginners ? 8 : 0) +
    (training ? 7 : 0) +
    (technicalAdvantage ? 5 : 0) +
    (relationshipWork ? 3 : 0) +
    (b2b ? 4 : 0) +
    (fixedSalary ? 3 : 0) -
    (commissionOnly ? 15 : 0) -
    (misleadingSalary ? 5 : 0);
  const score = Math.max(0, Math.min(100, initial.score + bonus));
  const eligibility =
    hardBlockers.length > 0
      ? 'INELIGIBLE'
      : uncertainties.length > 0
        ? 'UNCERTAIN'
        : 'ELIGIBLE';
  const salesModel = b2b
    ? b2c
      ? 'B2B and B2C'
      : 'B2B'
    : b2c
      ? 'B2C'
      : 'not explicit';
  const businessModel = financialAdvisory
    ? mlmLike
      ? 'recruitment-led financial advisory'
      : commissionOnly
        ? 'commission-only financial advisory'
        : fixedSalary
          ? commission
            ? 'financial advisory with fixed salary plus commission'
            : 'financial services with fixed salary'
          : 'financial advisory requiring compensation-model verification'
    : b2b
      ? 'business-to-business sales'
      : b2c
        ? 'consumer sales'
        : 'sales model not explicit';
  const compensation = [
    fixedSalary ? 'fixed salary' : undefined,
    commissionOnly ? 'commission only' : commission ? 'commission' : undefined,
    performanceBonus ? 'performance bonus' : undefined,
  ].filter(Boolean);
  const fit = hardBlockers.length
    ? `Does not match: ${hardBlockers.join('; ')}.`
    : `Matches a career transition into client acquisition and relationship building${welcomesBeginners ? '; previous sales experience is explicitly not required' : ''}${training ? '; training/onboarding is offered' : ''}${technicalAdvantage ? '; technical/startup experience is relevant' : ''}.`;

  return {
    ...initial,
    score,
    eligibility,
    recommendation: recommendationFor(score, profile),
    matchingSkills: [...new Set(matchingSkills)],
    hardBlockers: [...new Set(hardBlockers)],
    uncertainties: [...new Set(uncertainties)],
    reasoning: `Sales & Business Development category. ${fit} Sales model: ${salesModel}. Business model: ${businessModel}. Compensation: ${compensation.join(', ') || 'unclear'}${job.salaryMin || job.salaryMax ? '; advertised salary range present' : ''}. No professional sales achievements, revenue targets, or managed client portfolio were assumed.`,
    scoreBreakdown: {
      ...initial.scoreBreakdown,
      salesCategoryAdjustments: bonus,
    },
  };
};
