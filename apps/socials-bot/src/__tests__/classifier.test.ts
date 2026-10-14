import { describe, expect, it } from 'vitest';
import { LightweightIdeaClassifier } from '../classifier.js';

const topics = [
  {
    id: 'ai',
    name: 'AI automatizace',
    slug: 'ai-automatizace',
    pillar: 'AI a automatizace podnikání',
  },
  {
    id: 'business',
    name: 'Osobní podnikání',
    slug: 'osobni-podnikani',
    pillar: 'Podnikání a osobní značka',
  },
];

describe('lightweight idea classification', () => {
  it('works deterministically without Ollama', async () => {
    const result = await new LightweightIdeaClassifier().classify(
      'Lokální LLM automatizuje práci v CRM projektu Atlas',
      topics,
      [
        {
          id: 'atlas',
          name: 'Atlas',
          description: 'CRM integrace',
          technologies: ['TypeScript'],
        },
      ],
    );
    expect(result.usedLlm).toBe(false);
    expect(result.topicIds).toContain('ai');
    expect(result.projectIds).toContain('atlas');
  });
});
