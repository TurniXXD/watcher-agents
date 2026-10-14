import { describe, expect, it } from 'vitest';
import { buildChatGptPrompt, buildSundayContentPack } from '../prompts.js';

const item = {
  title: 'Automatizace CRM',
  channel: 'BLOG',
  format: 'BLOG_ARTICLE',
  contentPillar: 'AI a automatizace podnikání',
  targetAudience: 'české firmy',
  objective: 'QUALIFIED_LEADS',
  angle: 'praktická kritéria',
  hook: null,
  cta: null,
  plannedAt: new Date('2026-10-14T07:00:00Z'),
  requiredAssets: ['screenshot'],
  estimatedPreparationMinutes: 180,
  idea: { description: 'Poznámka z reálné implementace.' },
  topics: [{ topic: { name: 'CRM integrace' } }],
  projects: [
    {
      project: {
        name: 'Veřejný projekt',
        description: 'Ověřený popis',
        visibility: 'PUBLIC',
        websiteUrl: 'https://example.com',
      },
    },
    {
      project: {
        name: 'Tajný klient',
        description: 'Citlivá zakázka',
        visibility: 'PRIVATE',
        websiteUrl: null,
      },
    },
  ],
  sources: [
    {
      source: {
        title: 'Ověřený zdroj',
        url: 'https://example.com/source',
        summary: 'Doložený fakt',
        verificationStatus: 'VERIFIED',
      },
    },
    {
      source: {
        title: 'Neověřená poznámka',
        url: null,
        summary: 'Nesmí se použít',
        verificationStatus: 'UNVERIFIED',
      },
    },
  ],
};

describe('social prompt packs', () => {
  it('includes only public projects and verified sources', () => {
    const prompt = buildChatGptPrompt(item);
    expect(prompt).toContain('Veřejný projekt');
    expect(prompt).toContain('Ověřený zdroj');
    expect(prompt).toContain('SEO-aware článek v MDX');
    expect(prompt).not.toContain('Tajný klient');
    expect(prompt).not.toContain('Neověřená poznámka');
  });

  it('produces a deterministic pack with explicit manual publishing', () => {
    const input = { weekLabel: '2026-10-12', planId: 'plan-1', items: [item] };
    const first = buildSundayContentPack(input);
    expect(buildSundayContentPack(input)).toBe(first);
    expect(first).toContain('Publikování zůstává ruční');
    expect(first).toContain('Celkový odhad přípravy: 180 minut');
  });
});
