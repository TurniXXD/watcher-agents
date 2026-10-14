import { normalizeSocialText, socialSlug } from '@watcher/database';
import type { OllamaProvider } from '@watcher/llm';
import { z } from 'zod';

type Topic = { id: string; name: string; slug: string; pillar: string };
type Project = {
  id: string;
  name: string;
  description: string | null;
  technologies: readonly string[];
};

export type IdeaClassification = {
  title: string;
  topicIds: string[];
  projectIds: string[];
  pillar: string;
  usedLlm: boolean;
};

const llmClassificationSchema = z.object({
  conciseTitle: z.string().trim().min(3).max(140),
  topicSlugs: z.array(z.string().trim()).max(5),
  projectIds: z.array(z.string().trim()).max(5),
  pillar: z.string().trim().min(2).max(100),
});

const llmJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conciseTitle', 'topicSlugs', 'projectIds', 'pillar'],
  properties: {
    conciseTitle: { type: 'string' },
    topicSlugs: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    projectIds: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    pillar: { type: 'string' },
  },
} as const;

const keywordGroups: ReadonlyArray<{
  words: readonly string[];
  topicHints: readonly string[];
}> = [
  {
    words: ['ai', 'llm', 'qwen', 'ollama', 'automatiz', 'agent', 'asistent'],
    topicHints: [
      'ai-automatizace',
      'lokalni-llm',
      'optimalizace-firemnich-procesu',
    ],
  },
  {
    words: ['crm', 'obchod', 'lead', 'poptav', 'zakazn'],
    topicHints: ['crm-integrace', 'optimalizace-firemnich-procesu'],
  },
  {
    words: ['web', 'aplikac', 'typescript', 'react', 'api', 'system'],
    topicHints: ['webovy-vyvoj'],
  },
  {
    words: ['podnik', 'freelanc', 'znack', 'klient', 'sluzb'],
    topicHints: ['osobni-podnikani'],
  },
];

const deterministicClassification = (
  note: string,
  topics: readonly Topic[],
  projects: readonly Project[],
): IdeaClassification => {
  const normalized = normalizeSocialText(note);
  const hintedSlugs = new Set(
    keywordGroups.flatMap(({ words, topicHints }) =>
      words.some((word) => normalized.includes(word)) ? topicHints : [],
    ),
  );
  const matchedTopics = topics.filter(
    (topic) =>
      hintedSlugs.has(topic.slug) ||
      normalizeSocialText(topic.name)
        .split(' ')
        .some((word) => word.length >= 4 && normalized.includes(word)),
  );
  const matchedProjects = projects.filter((project) => {
    const terms = [
      project.name,
      project.description ?? '',
      ...project.technologies,
    ]
      .flatMap((value) => normalizeSocialText(value).split(' '))
      .filter((word) => word.length >= 4);
    return terms.some((word) => normalized.includes(word));
  });
  const selectedTopics = matchedTopics.length
    ? matchedTopics.slice(0, 5)
    : topics.filter((topic) => topic.slug === 'osobni-podnikani').slice(0, 1);
  return {
    title: note.trim().replaceAll(/\s+/gu, ' ').slice(0, 140),
    topicIds: selectedTopics.map((topic) => topic.id),
    projectIds: matchedProjects.slice(0, 5).map((project) => project.id),
    pillar: selectedTopics[0]?.pillar ?? 'Projekty a experimenty',
    usedLlm: false,
  };
};

export class LightweightIdeaClassifier {
  public constructor(private readonly llm?: OllamaProvider) {}

  public async classify(
    note: string,
    topics: readonly Topic[],
    projects: readonly Project[],
  ): Promise<IdeaClassification> {
    const fallback = deterministicClassification(note, topics, projects);
    if (!this.llm) return fallback;
    try {
      const result = await this.llm.generateStructured(
        `Roztřiď krátkou českou poznámku pro redakční plán. Nevymýšlej fakta. Vyber pouze existující topic slugy a project ID.
Poznámka: ${note.slice(0, 1_500)}
Témata: ${topics.map((topic) => `${topic.slug} (${topic.pillar})`).join(', ')}
Projekty: ${projects.map((project) => `${project.id}: ${project.name}`).join(', ') || 'žádné'}
Vrať stručný český název a metadata.`,
        llmJsonSchema,
        llmClassificationSchema,
        undefined,
        { maxAttempts: 2, numPredict: 256, temperature: 0 },
      );
      const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic]));
      const projectsById = new Map(
        projects.map((project) => [project.id, project]),
      );
      const selectedTopics = result.topicSlugs.flatMap((slug) => {
        const topic = topicBySlug.get(socialSlug(slug));
        return topic ? [topic] : [];
      });
      const selectedProjects = result.projectIds.filter((id) =>
        projectsById.has(id),
      );
      return {
        title: result.conciseTitle,
        topicIds: selectedTopics.length
          ? selectedTopics.map((topic) => topic.id)
          : fallback.topicIds,
        projectIds: selectedProjects.length
          ? selectedProjects
          : fallback.projectIds,
        pillar: selectedTopics[0]?.pillar || result.pillar || fallback.pillar,
        usedLlm: true,
      };
    } catch {
      return fallback;
    }
  }
}
