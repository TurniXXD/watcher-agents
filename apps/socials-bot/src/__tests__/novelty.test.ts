import { describe, expect, it } from 'vitest';
import { assessNovelty, type NoveltyCandidate } from '../novelty.js';

const candidate = (
  id: string,
  title: string,
  description = title,
): NoveltyCandidate => ({
  id,
  title,
  description,
  createdAt: new Date('2026-09-01T08:00:00Z'),
  updatedAt: new Date('2026-09-01T08:00:00Z'),
  topics: [{ topic: { id: 'ai', name: 'AI automatizace' } }],
  projects: [{ project: { id: 'crm', name: 'CRM' } }],
  contentItems: [
    {
      channel: 'LINKEDIN',
      plannedAt: null,
      publishedAt: new Date('2026-09-15T08:00:00Z'),
    },
  ],
});

describe('social content novelty', () => {
  it('recognizes normalized exact duplicates', () => {
    const existing = candidate('one', 'Lokální LLM pro české firmy');
    const result = assessNovelty({ title: 'Lokalni LLM pro ceske firmy' }, [
      existing,
    ]);
    expect(result.exactDuplicate?.id).toBe('one');
  });

  it('warns about semantic overlap and proposes another angle', () => {
    const existing = candidate(
      'one',
      'Jak automatizovat CRM pomocí lokálního LLM',
      'Praktická automatizace CRM s lokálním modelem',
    );
    const result = assessNovelty(
      {
        title: 'Automatizace CRM pomocí lokálního LLM v praxi',
        description: 'Praktická automatizace CRM s lokálním modelem',
        topicIds: ['ai'],
        projectIds: ['crm'],
      },
      [existing],
    );
    expect(result.similar[0]?.candidate.id).toBe('one');
    expect(result.similar[0]?.alternativeAngle).toContain('rozhodovací');
  });

  it('does not invent a match for unrelated material', () => {
    const result = assessNovelty({ title: 'Jak fotografovat krajinu' }, [
      candidate('one', 'Automatizace účetních dokladů'),
    ]);
    expect(result).toEqual({ similar: [] });
  });
});
