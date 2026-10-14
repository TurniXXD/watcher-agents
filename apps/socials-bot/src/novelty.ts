import { normalizeSocialText } from '@watcher/database';

export type NoveltyCandidate = {
  id: string;
  title: string;
  description: string;
  updatedAt: Date;
  createdAt: Date;
  topics: readonly { topic: { id: string; name: string } }[];
  projects: readonly { project: { id: string; name: string } }[];
  contentItems: readonly {
    channel: string;
    publishedAt: Date | null;
    plannedAt: Date | null;
  }[];
};

export type NoveltyAssessment = {
  exactDuplicate?: NoveltyCandidate;
  similar: readonly {
    candidate: NoveltyCandidate;
    score: number;
    explanation: string;
    alternativeAngle: string;
  }[];
};

const tokens = (value: string): Set<string> =>
  new Set(
    normalizeSocialText(value)
      .split(' ')
      .filter((token) => token.length >= 3),
  );

const overlap = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number => {
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / (left.size + right.size - shared);
};

export const assessNovelty = (
  input: {
    title: string;
    description?: string;
    topicIds?: readonly string[];
    projectIds?: readonly string[];
  },
  candidates: readonly NoveltyCandidate[],
): NoveltyAssessment => {
  const normalizedTitle = normalizeSocialText(input.title);
  const inputTokens = tokens(`${input.title} ${input.description ?? ''}`);
  const topicIds = new Set(input.topicIds ?? []);
  const projectIds = new Set(input.projectIds ?? []);
  const exactDuplicate = candidates.find(
    (candidate) => normalizeSocialText(candidate.title) === normalizedTitle,
  );
  const similar = candidates
    .flatMap((candidate) => {
      if (candidate.id === exactDuplicate?.id) return [];
      const titleScore = overlap(
        inputTokens,
        tokens(`${candidate.title} ${candidate.description}`),
      );
      const topicScore = overlap(
        topicIds,
        new Set(candidate.topics.map(({ topic }) => topic.id)),
      );
      const projectScore = overlap(
        projectIds,
        new Set(candidate.projects.map(({ project }) => project.id)),
      );
      const score = titleScore * 0.7 + topicScore * 0.18 + projectScore * 0.12;
      if (score < 0.58) return [];
      const last = candidate.contentItems.find(
        (item) => item.publishedAt || item.plannedAt,
      );
      const date = last?.publishedAt ?? last?.plannedAt;
      const explanation = date
        ? `Podobný obsah byl naplánován nebo publikován ${date.toLocaleDateString('cs-CZ')} na ${last?.channel ?? 'jiném kanálu'}.`
        : 'Velmi podobný nápad už je v zásobníku.';
      return [
        {
          candidate,
          score,
          explanation,
          alternativeAngle:
            'Zaměř nový úhel na konkrétní náklady neřešeného problému, rozhodovací kritéria nebo nové ověřené poznatky z projektu.',
        },
      ];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  return { ...(exactDuplicate ? { exactDuplicate } : {}), similar };
};
