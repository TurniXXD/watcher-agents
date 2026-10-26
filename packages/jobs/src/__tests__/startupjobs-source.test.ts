import { describe, expect, it } from 'vitest';
import {
  parseStartupJobsPage,
  parseStartupJobsSitemap,
} from '../startupjobs-source.js';

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.startupjobs.cz/nabidka/108057/vyvojar-vyvojarka-fullstack-fe-be</loc></url>
  <url><loc>https://www.startupjobs.cz/startup/example</loc></url>
  <url><loc>https://example.com/nabidka/1/not-startupjobs</loc></url>
</urlset>`;

const listing = parseStartupJobsSitemap(sitemap)[0]!;

const page = (posting: Record<string, unknown>) => `<!doctype html>
<html><head>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', url: 'https://www.startupjobs.cz/' },
    posting,
  ],
})}</script>
</head></html>`;

describe('StartupJobs.cz source', () => {
  it('reads only public offer URLs from the official sitemap', () => {
    const jobs = parseStartupJobsSitemap(sitemap);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      sourceId: 'startupjobs-cz',
      externalId: '108057',
      title: 'vyvojar vyvojarka fullstack fe be',
      originalUrl:
        'https://www.startupjobs.cz/nabidka/108057/vyvojar-vyvojarka-fullstack-fe-be',
    });
  });

  it('normalizes schema.org JobPosting detail without scraping visual markup', () => {
    const job = parseStartupJobsPage(
      page({
        '@type': 'JobPosting',
        title: 'FullStack Developer (m/f)',
        description:
          '<p>Build products in TypeScript, React, Next.js and Node.js.</p><p>Po zkušební době remote.</p>',
        url: listing.originalUrl,
        datePosted: '2026-09-30T08:12:43.000Z',
        identifier: { value: '108057' },
        employmentType: ['FULL_TIME', 'CONTRACTOR'],
        hiringOrganization: { name: 'Objednáme' },
        jobLocation: {
          address: {
            addressLocality: 'Ostrava',
            addressRegion: 'Moravskoslezský kraj',
            addressCountry: 'Česko',
          },
        },
        baseSalary: {
          currency: 'CZK',
          value: {
            minValue: 50_000,
            maxValue: 100_000,
            unitText: 'MONTH',
          },
        },
      }),
      listing,
    );

    expect(job).toMatchObject({
      sourceId: 'startupjobs-cz',
      externalId: '108057',
      title: 'FullStack Developer (m/f)',
      company: 'Objednáme',
      location: 'Ostrava, Moravskoslezský kraj, Česko',
      country: 'Česko',
      city: 'Ostrava',
      workMode: 'HYBRID',
      salaryMin: 50_000,
      salaryMax: 100_000,
      salaryCurrency: 'CZK',
      salaryPeriod: 'MONTH',
      contractType: 'FULL_TIME, CONTRACTOR',
    });
    expect(job.technologyStack).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Next.js', 'Node.js']),
    );
    expect(job.publishedAt?.toISOString()).toBe('2026-09-30T08:12:43.000Z');
  });

  it('preserves explicit remote eligibility regions', () => {
    const job = parseStartupJobsPage(
      page({
        '@type': 'JobPosting',
        title: 'TypeScript Developer',
        description: '<p>Fully remote TypeScript role.</p>',
        url: listing.originalUrl,
        identifier: '108057',
        jobLocationType: 'TELECOMMUTE',
        applicantLocationRequirements: [
          { name: 'Czechia' },
          { name: 'European Union' },
        ],
        hiringOrganization: { name: 'Example' },
      }),
      listing,
    );

    expect(job.workMode).toBe('REMOTE');
    expect(job.remoteRegions).toEqual(['Czechia', 'European Union']);
  });

  it('rejects a detail page without valid JobPosting structured data', () => {
    expect(() =>
      parseStartupJobsPage(
        '<html><script type="application/ld+json">{"@type":"WebSite"}</script></html>',
        listing,
      ),
    ).toThrow('valid JobPosting JSON-LD');
  });
});
