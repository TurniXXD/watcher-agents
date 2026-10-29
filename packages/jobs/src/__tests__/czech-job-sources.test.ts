import { describe, expect, it } from 'vitest';
import {
  jobsCzDiscoveryUrls,
  parseCoolJobsDetail,
  parseCoolJobsListings,
  parseJobsCzDetail,
  parseJobsCzListings,
  parseJobsiDetail,
  parseJobstackDetail,
  parsePraceCzListings,
  parsePraceZaRohemDetail,
  parsePraceZaRohemListings,
  praceCzDiscoveryUrls,
  praceZaRohemDiscoveryUrls,
} from '../czech-job-sources.js';
import { parseSchemaJobPostingPage } from '../schema-jobposting.js';
import { createJobSourceDefinitions } from '../sources.js';
import { normalizedJobSchema } from '../types.js';

const listing = (sourceId: string, url: string) =>
  normalizedJobSchema.parse({
    externalId: '123',
    sourceId,
    title: 'placeholder',
    company: 'placeholder',
    description: 'placeholder',
    workMode: 'UNKNOWN',
    remoteRegions: [],
    technologyStack: [],
    originalUrl: url,
    canonicalApplicationUrl: url,
    raw: {},
  });

describe('Czech job source connectors', () => {
  it('registers every Czech source as an enabled built-in adapter', () => {
    const definitions = new Map(
      createJobSourceDefinitions().map((source) => [source.id, source]),
    );

    const strategies = {
      'startupjobs-cz': 'SITEMAP',
      'cooljobs-eu': 'HTML',
      'prace-za-rohem': 'HTML',
      'jobs-cz': 'HTML',
      'prace-cz': 'HTML',
      'jobstack-it': 'SITEMAP',
      'jobsi-cz': 'SITEMAP',
      'jenprace-cz': 'SITEMAP',
    } as const;
    for (const [id, strategy] of Object.entries(strategies)) {
      expect(definitions.get(id)).toMatchObject({
        enabledByDefault: true,
        strategy,
      });
      expect(definitions.get(id)?.adapter).toBeDefined();
    }
  });

  it('keeps the technical discovery pages and adds verified Czech sales searches', () => {
    expect(jobsCzDiscoveryUrls).toEqual(
      expect.arrayContaining([
        'https://www.jobs.cz/prace/is-it-vyvoj-aplikaci-a-systemu/',
        'https://www.jobs.cz/prace/brno/account-manager/',
        'https://www.jobs.cz/prace/obchodni-zastupce/',
      ]),
    );
    expect(praceCzDiscoveryUrls).toEqual(
      expect.arrayContaining([
        'https://www.prace.cz/nabidky/programator/',
        'https://www.prace.cz/nabidky/obchodni-zastupce/',
        'https://www.prace.cz/nabidky/account-manager/',
      ]),
    );
    expect(praceZaRohemDiscoveryUrls).toEqual(
      expect.arrayContaining([
        'https://www.pracezarohem.cz/nabidky/is-it-vyvoj-aplikaci-a-systemu',
        'https://www.pracezarohem.cz/nabidky/jihomoravsky/brno-mesto/prodej-a-obchod',
      ]),
    );
  });

  it('parses Jobs.cz public cards and combines public detail metadata and body', () => {
    const jobs = parseJobsCzListings(`
      <article class="SearchResultCard">
        <a href="/rpd/2000123456/?searchId=x">TypeScript Developer</a>
        <footer><span class="SearchResultCard__footerItem" translate="no">Acme s.r.o.</span></footer>
        <span data-test="serp-locality">Praha</span>
      </article>`);
    expect(jobs[0]).toMatchObject({
      externalId: '2000123456',
      title: 'TypeScript Developer',
      company: 'Acme s.r.o.',
      location: 'Praha',
      originalUrl: 'https://www.jobs.cz/rpd/2000123456',
    });

    const detail = parseJobsCzDetail(
      `<meta property="og:title" content="TypeScript Developer">
       <meta name="description" content="Build a product.">
       <main>React and Node.js. English required. Three years of experience.</main>`,
      jobs[0]!,
    );
    expect(detail.description).toContain('English required');
    expect(detail.technologyStack).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Node.js']),
    );
  });

  it('uses public Prace.cz cards and JobPosting structured data', () => {
    const jobs = parsePraceCzListings(`
      <article>
        <a title="Frontend developer" href="/nabidka/123e4567-e89b-12d3-a456-426614174000/">Frontend developer</a>
        <span translate="no">Example s.r.o.</span><span class="location">Brno</span>
      </article>`);
    expect(jobs).toHaveLength(1);
    const detail = parseSchemaJobPostingPage({
      sourceId: 'prace-cz',
      listing: jobs[0]!,
      html: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'JobPosting',
        title: 'Frontend developer',
        description: '<p>React and TypeScript, English only.</p>',
        hiringOrganization: { name: 'Example s.r.o.' },
        identifier: { value: '123e4567-e89b-12d3-a456-426614174000' },
        jobLocation: {
          address: { addressLocality: 'Brno', addressCountry: 'CZ' },
        },
      })}</script>`,
    });
    expect(detail).toMatchObject({
      company: 'Example s.r.o.',
      city: 'Brno',
      country: 'CZ',
      location: 'Brno, CZ',
    });
  });

  it('validates Práce za rohem Next.js listing and detail payloads', () => {
    const page = (pageProps: unknown) =>
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script>`;
    const jobs = parsePraceZaRohemListings(
      page({
        adverts: {
          adverts: [
            {
              id: 'PZRG-123',
              title: 'Node.js developer',
              company: 'Acme',
              valid: true,
              validStart: 1_798_000_000,
              location: { place: 'Praha' },
            },
          ],
        },
      }),
    );
    const detail = parsePraceZaRohemDetail(
      page({
        advert: {
          id: 'PZRG-123',
          title: 'Node.js developer',
          company: 'Acme',
          valid: true,
          location: { label: 'Praha' },
          desc: '<p>TypeScript and Node.js, 100% remote.</p>',
          descFields: {
            jobProperties: [{ label: 'Jazyky', value: 'Angličtina' }],
          },
        },
      }),
      jobs[0]!,
    );
    expect(detail).toMatchObject({
      externalId: 'PZRG-123',
      company: 'Acme',
      workMode: 'REMOTE',
    });
    expect(detail.description).toContain('Jazyky: Angličtina');
  });

  it('extracts complete filtering evidence from Jobsi and Jobstack details', () => {
    const jobsi = parseJobsiDetail(
      `<div class="job_detail"><h1>React developer</h1>
       <div class="job_top_info"><span class="company">Acme</span><span class="city">Praha</span></div>
       <div class="bottom">React. Bachelor degree in computer science required. Six years experience.</div></div>`,
      listing('jobsi-cz', 'https://jobsi.cz/job/123-react-developer'),
    );
    expect(jobsi.description).toContain('Bachelor degree');

    const jobstack = parseJobstackDetail(
      `<h1>TypeScript developer</h1><a href="/company-profile/acme">Acme</a>
       <div class="wysiwyg-content">Build Node.js products.</div>
       <div><h6 class="jobpost-label-2023">Jazyky</h6>English required</div>
       <div><h6 class="jobpost-label-2023">Praxe</h6>3 roky</div>`,
      listing(
        'jobstack-it',
        'https://www.jobstack.it/it-job/typescript-developer/abc123',
      ),
    );
    expect(jobstack.description).toContain('English required');
    expect(jobstack.technologyStack).toEqual(
      expect.arrayContaining(['TypeScript', 'Node.js']),
    );
  });

  it('parses CoolJobs active listing fields and public detail description', () => {
    const jobs = parseCoolJobsListings(`
      <a href="react/43921"># 43921 React Developer Místo: Praha Start: ihned Smlouva: IČO Home office: 100%</a>`);
    expect(jobs[0]).toMatchObject({
      externalId: '43921',
      sourceId: 'cooljobs-eu',
      location: 'Praha',
      workMode: 'REMOTE',
      originalUrl: 'https://www.cooljobs.eu/cz/react/43921',
    });
    const detail = parseCoolJobsDetail(
      `<h1>React Developer (43921)</h1><meta name="description" content="React and TypeScript. English required.">`,
      jobs[0]!,
    );
    expect(detail.title).toBe('React Developer');
    expect(detail.description).toContain('English required');
  });
});
