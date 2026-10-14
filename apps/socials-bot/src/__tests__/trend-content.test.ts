import { describe, expect, it, vi } from 'vitest';
import type { OllamaProvider } from '@watcher/llm';
import { CzechTrendContentAgent } from '../trends/content-agent.js';

const input = {
  cluster: {
    canonicalKey: 'ai-agents',
    title: 'AI agents for small business',
    keywords: ['agents', 'business'],
    signals: [
      {
        id: '1',
        externalId: '1',
        source: 'YOUTUBE' as const,
        sourceUrl: 'https://www.youtube.com/watch?v=example',
        title: 'AI agents for small business',
        region: 'US' as const,
        collectedAt: new Date('2026-10-14T05:00:00Z'),
        metrics: {},
      },
    ],
  },
  momentum: {
    stage: 'UNKNOWN' as const,
    observationCount: 1,
    independentSourceCount: 1,
    ageDays: 0,
    persistenceDays: 0,
    explanation: 'Insufficient history',
    missingData: ['History'],
  },
  comparison: {
    status: 'UNCERTAIN' as const,
    confidence: 30,
    explanation: 'Missing Czech evidence',
    missingData: ['Czech evidence'],
    usEvidence: {},
    czEvidence: {},
  },
  focusTopics: ['AI integrations'],
  audiences: ['Czech business owners'],
};

describe('Czech trend content agent', () => {
  it('falls back safely when local AI returns invalid output', async () => {
    const llm = {
      generateStructured: vi.fn(async () => {
        throw new Error('invalid structured output');
      }),
    } as unknown as OllamaProvider;
    const result = await new CzechTrendContentAgent(llm).generate(input);
    expect(result.usedLlm).toBe(false);
    expect(result.concept.hooks.curiosity).toContain('AI agents');
    expect(result.concept.linkedInPost).toContain('Než něco nasadíte');
    expect(result.concept.claimsToVerify.length).toBeGreaterThan(0);
    expect(result.concept.originalityNote).toContain('nekopíruje');
  });
});
