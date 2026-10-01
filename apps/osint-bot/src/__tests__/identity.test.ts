import { describe, expect, it, vi } from 'vitest';
import { createGithubCollector } from '../collectors/identity.js';

describe('public identity collectors', () => {
  it('stores bounded GitHub profile metadata without asserting identity', async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            login: 'octocat',
            id: 1,
            html_url: 'https://github.com/octocat',
            type: 'User',
            name: 'The Octocat',
            company: '@github',
            public_repos: 8,
            followers: 10,
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const documents = await createGithubCollector({
      fetcher,
      resolvePublicUrl: async (value) => new URL(value),
    }).collect(
      {
        type: 'GITHUB_PROFILE',
        value: 'octocat',
        original: 'github: octocat',
        depth: 0,
      },
      new AbortController().signal,
    );

    expect(documents[0]?.sourceUrl).toBe('https://github.com/octocat');
    expect(documents[0]?.data).toMatchObject({
      login: 'octocat',
      githubId: 1,
      publicRepositories: 8,
    });
    expect(documents[0]?.excerpt).toContain('nepotvrzuje totožnost');
  });
});
