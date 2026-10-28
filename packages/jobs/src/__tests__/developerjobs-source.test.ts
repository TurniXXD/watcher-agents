import { describe, expect, it } from 'vitest';
import {
  parseDeveloperJobsPage,
  parseDeveloperJobsRss,
} from '../developerjobs-source.js';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
  <title>Full Stack Engineer · Example AG</title>
  <link>https://developerjobs.ch/en/jobs/fead9c89-0bf7-42a8-b3c4-edb00694f13f</link>
  <guid isPermaLink="true">https://developerjobs.ch/en/jobs/fead9c89-0bf7-42a8-b3c4-edb00694f13f</guid>
  <pubDate>Tue, 27 Oct 2026 06:10:36 GMT</pubDate>
  <description>Build products with React and TypeScript.</description>
</item></channel></rss>`;

describe('DeveloperJobs.ch source', () => {
  it('reads the provider-owned English RSS feed', () => {
    const jobs = parseDeveloperJobsRss(rss);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      externalId: 'fead9c89-0bf7-42a8-b3c4-edb00694f13f',
      sourceId: 'developerjobs-ch',
      title: 'Full Stack Engineer',
      company: 'Example AG',
      originalUrl:
        'https://developerjobs.ch/en/jobs/fead9c89-0bf7-42a8-b3c4-edb00694f13f',
    });
  });

  it('enriches a listing only from schema.org JobPosting data', () => {
    const listing = parseDeveloperJobsRss(rss)[0]!;
    const posting = {
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      title: 'Full Stack Engineer',
      description:
        '<p>Build React, TypeScript and Node.js products in English.</p>',
      datePosted: '2026-10-27T00:00:00.000Z',
      validThrough: '2026-12-26T23:59:59.000Z',
      employmentType: 'CONTRACTOR',
      hiringOrganization: { name: 'Example AG' },
      url: listing.originalUrl,
      jobLocation: {
        address: {
          addressLocality: 'Zürich',
          addressRegion: 'Zürich',
          addressCountry: 'Switzerland',
        },
      },
    };
    const job = parseDeveloperJobsPage(
      `<html><script type="application/ld+json">${JSON.stringify(posting)}</script></html>`,
      listing,
    );

    expect(job).toMatchObject({
      company: 'Example AG',
      location: 'Zürich, Switzerland',
      country: 'Switzerland',
      city: 'Zürich',
      workMode: 'ONSITE',
      contractType: 'CONTRACTOR',
    });
    expect(job.technologyStack).toEqual(
      expect.arrayContaining(['React', 'TypeScript', 'Node.js']),
    );
  });

  it('rejects detail HTML without validated JobPosting data', () => {
    expect(() =>
      parseDeveloperJobsPage('<html></html>', parseDeveloperJobsRss(rss)[0]!),
    ).toThrow('valid JobPosting JSON-LD');
  });
});
