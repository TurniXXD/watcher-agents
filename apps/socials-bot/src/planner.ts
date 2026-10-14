import type { SocialPlanItemInput } from '@watcher/database';
import { assessNovelty, type NoveltyCandidate } from './novelty.js';
import { planDate, type IsoWeekRange } from './time.js';

export type PlanningAnswers = {
  workedOn: string;
  discovered: string;
  problem: string;
  promotedService: string;
  assets: string;
  preparationMinutes: number;
};

export type PlannerIdea = NoveltyCandidate & {
  status: string;
  priority: string;
  businessObjective: SocialPlanItemInput['objective'];
};

type ExistingContent = {
  ideaId: string;
  channel: string;
  status: string;
  plannedAt: Date | null;
  publishedAt: Date | null;
};

type Slot = {
  channel: SocialPlanItemInput['channel'];
  format: SocialPlanItemInput['format'];
  weekday: number;
  time: string;
  minutes: number;
};

const baseSlots: readonly Slot[] = [
  {
    channel: 'LINKEDIN',
    format: 'TEXT_POST',
    weekday: 1,
    time: '09:00',
    minutes: 45,
  },
  {
    channel: 'INSTAGRAM',
    format: 'REEL',
    weekday: 2,
    time: '18:00',
    minutes: 75,
  },
  {
    channel: 'LINKEDIN',
    format: 'TEXT_POST',
    weekday: 4,
    time: '09:00',
    minutes: 45,
  },
  {
    channel: 'INSTAGRAM',
    format: 'CAROUSEL',
    weekday: 5,
    time: '17:00',
    minutes: 90,
  },
];

const monthlySlots: readonly Slot[] = [
  {
    channel: 'BLOG',
    format: 'BLOG_ARTICLE',
    weekday: 3,
    time: '09:00',
    minutes: 180,
  },
  {
    channel: 'NEWSLETTER',
    format: 'NEWSLETTER_ISSUE',
    weekday: 7,
    time: '10:00',
    minutes: 180,
  },
];

const priorityScore = (priority: string): number =>
  priority === 'HIGH' ? 30 : priority === 'MEDIUM' ? 15 : 0;

const ideaScore = (idea: PlannerIdea, answers: PlanningAnswers): number => {
  const context =
    `${answers.workedOn} ${answers.discovered} ${answers.problem} ${answers.promotedService}`.toLocaleLowerCase(
      'cs-CZ',
    );
  const words = idea.title
    .toLocaleLowerCase('cs-CZ')
    .split(/\W+/u)
    .filter((word) => word.length >= 4);
  const contextMatches = words.filter((word) => context.includes(word)).length;
  return (
    priorityScore(idea.priority) +
    contextMatches * 8 +
    idea.projects.length * 6 +
    idea.topics.length * 2 +
    (idea.status === 'BACKLOG' ? 8 : 0)
  );
};

const suitable = (
  slot: Slot,
  answers: PlanningAnswers,
  idea: PlannerIdea,
): boolean => {
  if (slot.format !== 'REEL') return true;
  const hasVisual = !/^(ne|nemam|nemám|žádné|zadne|no)$/iu.test(
    answers.assets.trim(),
  );
  return hasVisual || idea.projects.length > 0;
};

const angleFor = (
  slot: Slot,
  idea: PlannerIdea,
  answers: PlanningAnswers,
): string => {
  if (slot.channel === 'LINKEDIN') {
    return `Praktický pohled pro české firmy: ${idea.title}. Navázat na skutečný problém „${answers.problem.slice(0, 180)}“ bez vymyšlených výsledků.`;
  }
  if (slot.format === 'REEL') {
    return `Krátká ukázka nebo vysvětlení ${idea.title}; použít pouze dostupné vlastní vizuály: ${answers.assets.slice(0, 180)}.`;
  }
  return `Vzdělávací rozklad tématu ${idea.title} do konkrétních kroků a rozhodovacích kritérií.`;
};

const recentForChannel = (
  ideaId: string,
  channel: string,
  existing: readonly ExistingContent[],
  weekStart: Date,
): ExistingContent | undefined =>
  existing.find((item) => {
    const date = item.publishedAt ?? item.plannedAt;
    return (
      item.ideaId === ideaId &&
      item.channel === channel &&
      date !== null &&
      date.getTime() >= weekStart.getTime() - 8 * 7 * 24 * 60 * 60_000
    );
  });

export const buildWeeklyPlan = (input: {
  ideas: readonly PlannerIdea[];
  existingContent: readonly ExistingContent[];
  answers: PlanningAnswers;
  week: IsoWeekRange;
  timezone: string;
}): SocialPlanItemInput[] => {
  const ranked = [...input.ideas].sort(
    (left, right) =>
      ideaScore(right, input.answers) - ideaScore(left, input.answers) ||
      left.createdAt.getTime() - right.createdAt.getTime(),
  );
  let remainingMinutes = Math.max(0, input.answers.preparationMinutes);
  const used = new Set<string>();
  const result: SocialPlanItemInput[] = [];
  const month = input.week.start.getUTCMonth();
  const year = input.week.start.getUTCFullYear();
  const monthlyCount = (channel: string): number =>
    input.existingContent.filter((item) => {
      const date = item.publishedAt ?? item.plannedAt;
      return (
        item.channel === channel &&
        date !== null &&
        date.getUTCMonth() === month &&
        date.getUTCFullYear() === year
      );
    }).length;
  const slots = [
    ...baseSlots,
    ...(monthlyCount('BLOG') < 2 ? [monthlySlots[0]!] : []),
    ...(monthlyCount('NEWSLETTER') < 1 ? [monthlySlots[1]!] : []),
  ];
  for (const slot of slots) {
    if (remainingMinutes < slot.minutes) continue;
    const idea = ranked.find(
      (candidate) =>
        !used.has(candidate.id) &&
        suitable(slot, input.answers, candidate) &&
        !recentForChannel(
          candidate.id,
          slot.channel,
          input.existingContent,
          input.week.start,
        ),
    );
    if (!idea) continue;
    const otherCandidates = ranked.filter(
      (candidate) => candidate.id !== idea.id,
    );
    const novelty = assessNovelty(
      {
        title: idea.title,
        description: idea.description,
        topicIds: idea.topics.map(({ topic }) => topic.id),
        projectIds: idea.projects.map(({ project }) => project.id),
      },
      otherCandidates,
    );
    const similarityWarning = novelty.similar[0]
      ? `${novelty.similar[0].explanation} ${novelty.similar[0].alternativeAngle}`
      : undefined;
    result.push({
      ideaId: idea.id,
      title: idea.title,
      channel: slot.channel,
      format: slot.format,
      contentPillar: idea.topics[0]?.topic.name ?? 'Projekty a experimenty',
      targetAudience: 'Čeští majitelé menších a středních firem a podnikatelé',
      objective: idea.businessObjective,
      angle: angleFor(slot, idea, input.answers),
      planningReason:
        idea.projects.length > 0
          ? 'Téma vychází z reálného projektu a podporuje důvěryhodnost konkrétní prací.'
          : 'Téma odpovídá aktuálnímu zásobníku, cíli týdne a dostupnému času.',
      ...(similarityWarning ? { similarityWarning } : {}),
      hook: `Co se v praxi ukázalo u tématu „${idea.title}“?`,
      cta: `Pokud podobný problém řešíte ve firmě, napište mi konkrétní situaci — bez závazku ji stručně rozeberu.`,
      requiredAssets:
        slot.format === 'REEL'
          ? [
              input.answers.assets ||
                'Krátká obrazovková ukázka nebo vlastní fotografie',
            ]
          : [],
      plannedAt: planDate(input.week, slot.weekday, slot.time, input.timezone),
      estimatedPreparationMinutes: slot.minutes,
      topicIds: idea.topics.map(({ topic }) => topic.id),
      projectIds: idea.projects.map(({ project }) => project.id),
    });
    used.add(idea.id);
    remainingMinutes -= slot.minutes;
  }
  return result;
};
