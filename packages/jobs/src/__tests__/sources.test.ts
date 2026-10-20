import { describe, expect, it } from 'vitest';
import { parseRemoteFrontendJob, parseRemoteOkJob } from '../sources.js';

describe('verified job source schemas', () => {
  it('accepts the documented Remote Frontend Jobs comma-delimited API fields', () => {
    const job = parseRemoteFrontendJob('remote-frontend-jobs', {
      id: 'job-123',
      title: 'Frontend Engineer',
      location: 'Europe',
      geoRegions: ',europe,worldwide,',
      tags: ',react,typescript,',
      link: 'https://employer.example/jobs/123?utm_source=board',
      content: '<p>Build React applications with TypeScript.</p>',
      contentSnippet: 'Build React applications.',
      forcedRemote: true,
      createdAt: '2026-10-20T08:00:00.000Z',
      company: { name: 'Example' },
    });

    expect(job).toMatchObject({
      externalId: 'job-123',
      originalUrl: 'https://www.remotefrontendjobs.com/job-123',
      canonicalApplicationUrl: 'https://employer.example/jobs/123',
      remoteRegions: ['europe', 'worldwide'],
      technologyStack: ['TypeScript', 'React'],
      workMode: 'REMOTE',
    });
  });

  it('does not invent worldwide eligibility for an unspecified remote region', () => {
    const job = parseRemoteOkJob({
      id: 'remote-1',
      position: 'TypeScript Engineer',
      company: 'Example',
      description: 'Remote TypeScript role.',
      tags: ['typescript'],
      url: 'https://remoteok.com/remote-jobs/remote-1',
    });

    expect(job.workMode).toBe('REMOTE');
    expect(job.remoteRegions).toEqual([]);
  });
});
