import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createJobSourceDefinitions,
  parseRemoteFrontendJob,
  parseRemoteOkJob,
  parseWorkingNomadsJob,
} from '../sources.js';
import { parseArbeitnowJob, parseJobicyJob } from '../public-api-sources.js';
import { parseGreenhouseJob } from '../ats-sources.js';

describe('verified job source schemas', () => {
  it('normalizes Agoda jobs from its public Greenhouse board', () => {
    const job = parseGreenhouseJob({
      sourceId: 'agoda-careers',
      board: 'agoda',
      company: 'Agoda',
      workMode: 'HYBRID',
      job: {
        id: 12345,
        title: 'Full Stack Engineer',
        updated_at: '2026-10-26T09:30:00Z',
        location: { name: 'Bangkok, Thailand' },
        absolute_url: 'https://job-boards.greenhouse.io/agoda/jobs/12345',
        content: '<p>Build products with React, TypeScript and Node.js.</p>',
        departments: [{ name: 'Technology' }],
      },
    });

    expect(job).toMatchObject({
      sourceId: 'agoda-careers',
      externalId: 'agoda:12345',
      company: 'Agoda',
      title: 'Full Stack Engineer',
      location: 'Bangkok, Thailand',
      workMode: 'HYBRID',
      originalUrl: 'https://job-boards.greenhouse.io/agoda/jobs/12345',
    });
    expect(job.technologyStack).toEqual(
      expect.arrayContaining(['React', 'TypeScript', 'Node.js']),
    );
  });

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

  it('normalizes the public Working Nomads payload with a stable listing id', () => {
    const job = parseWorkingNomadsJob({
      url: 'https://www.workingnomads.com/job/go/12345/?utm_source=feed',
      title: 'Full-Stack Engineer',
      company_name: 'Example',
      description: '<p>Build with React, TypeScript and Node.js.</p>',
      category_name: 'Development',
      tags: 'react,typescript,node.js',
      location: 'Europe',
      pub_date: '2026-10-22T08:30:00+02:00',
    });

    expect(job).toMatchObject({
      externalId: '12345',
      sourceId: 'working-nomads',
      company: 'Example',
      workMode: 'REMOTE',
      remoteRegions: ['Europe'],
      originalUrl: 'https://www.workingnomads.com/job/go/12345',
    });
    expect(job.technologyStack).toEqual(
      expect.arrayContaining(['React', 'TypeScript', 'Node.js']),
    );
  });

  it('normalizes the public Arbeitnow API payload', () => {
    const job = parseArbeitnowJob({
      slug: 'typescript-engineer-example-123',
      company_name: 'Example GmbH',
      title: 'TypeScript Engineer',
      description:
        '<p>Build React and Node.js services in English. Fully remote.</p>',
      remote: true,
      url: 'https://www.arbeitnow.com/jobs/companies/example/typescript-engineer-example-123',
      tags: ['TypeScript', 'React'],
      job_types: ['Full-time', 'Contract'],
      location: 'Europe',
      created_at: 1_793_086_241,
    });

    expect(job).toMatchObject({
      externalId: 'typescript-engineer-example-123',
      sourceId: 'arbeitnow',
      company: 'Example GmbH',
      workMode: 'REMOTE',
      contractType: 'Full-time, Contract',
    });
    expect(job.technologyStack).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Node.js']),
    );
  });

  it('normalizes Jobicy without broadening its remote location', () => {
    const job = parseJobicyJob({
      id: 157_288,
      url: 'https://jobicy.com/jobs/157288-typescript-engineer',
      jobTitle: 'TypeScript Engineer',
      companyName: 'Example',
      jobIndustry: ['Software Engineering'],
      jobType: ['Contract'],
      jobGeo: 'Europe',
      jobLevel: 'Mid-level',
      jobExcerpt: 'Build web products.',
      jobDescription: '<p>Build React and Node.js products.</p>',
      pubDate: '2026-10-27T05:21:41+00:00',
      salaryMin: 80_000.4,
      salaryMax: 100_000.8,
      salaryCurrency: 'EUR',
      salaryPeriod: 'yearly',
    });

    expect(job).toMatchObject({
      externalId: '157288',
      sourceId: 'jobicy',
      workMode: 'REMOTE',
      remoteRegions: ['Europe'],
      salaryMin: 80_000,
      salaryMax: 100_001,
      canonicalApplicationUrl:
        'https://jobicy.com/jobs/157288-typescript-engineer',
    });
  });
});

describe('job source documentation inventory', () => {
  it('lists every registered source exactly once in the Jobs Bot README', () => {
    const readme = readFileSync(
      new URL('../../../../apps/jobs-bot/README.md', import.meta.url),
      'utf8',
    );
    const documentedSourceIds = [
      ...readme.matchAll(/^\| `([^`]+)`\s+\|/gmu),
    ].map((match) => match[1]);
    const registeredSourceIds = createJobSourceDefinitions().map(
      ({ id }) => id,
    );

    expect(documentedSourceIds).toEqual(registeredSourceIds);
  });
});
