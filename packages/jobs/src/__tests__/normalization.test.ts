import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  cleanHtml,
  createJobSourceDefinitions,
  createLinkedinAlertAdapter,
  jobContentHash,
  jobFingerprint,
} from '../index.js';

describe('job normalization and identity', () => {
  it('canonicalizes URLs without tracking parameters or fragments', () => {
    expect(
      canonicalizeUrl(
        'HTTPS://Example.COM/jobs/42/?utm_source=x&ref=feed&role=dev#apply',
      ),
    ).toBe('https://example.com/jobs/42?role=dev');
  });

  it('sanitizes executable markup from descriptions', () => {
    expect(cleanHtml('<script>alert(1)</script><p>Build &amp; ship</p>')).toBe(
      'Build & ship',
    );
  });

  it('deduplicates the same company, title and location across sources', () => {
    const first = jobFingerprint({
      company: 'Example s.r.o.',
      title: 'Senior React Engineer',
      location: 'Brno',
    });
    const second = jobFingerprint({
      company: 'EXAMPLE S.R.O.',
      title: 'Senior React Engineer ',
      location: 'Brno',
    });
    expect(first).toBe(second);
  });

  it('detects changed descriptions', () => {
    const common = { title: 'Developer', company: 'Example' };
    expect(jobContentHash({ ...common, description: 'React' })).not.toBe(
      jobContentHash({ ...common, description: 'React and Node.js' }),
    );
  });

  it('keeps stable source IDs and explicit unsupported sources', () => {
    const definitions = createJobSourceDefinitions();
    expect(definitions.filter((source) => source.adapter)).toHaveLength(22);
    expect(
      definitions.find((source) => source.id === 'remote-backend-jobs'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'API' });
    expect(
      definitions.find((source) => source.id === 'remote-first-jobs'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'RSS' });
    expect(
      definitions.find((source) => source.id === 'working-nomads'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'API' });
    expect(
      definitions.find((source) => source.id === 'startupjobs-cz'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'SITEMAP' });
    expect(
      definitions.find((source) => source.id === 'agoda-careers'),
    ).toMatchObject({
      name: 'Agoda Careers',
      baseUrl: 'https://careersatagoda.com',
      enabledByDefault: true,
      strategy: 'ATS',
    });
    expect(
      definitions.find((source) => source.id === 'developerjobs-ch'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'RSS' });
    expect(
      definitions.find((source) => source.id === 'arbeitnow'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'API' });
    expect(definitions.find((source) => source.id === 'jobicy')).toMatchObject({
      enabledByDefault: true,
      strategy: 'API',
    });
    expect(
      definitions.find((source) => source.id === 'linkedin'),
    ).toMatchObject({
      enabledByDefault: false,
      strategy: 'DISABLED',
    });
    expect(
      createJobSourceDefinitions(
        {},
        createLinkedinAlertAdapter(async () => []),
      ).find((source) => source.id === 'linkedin'),
    ).toMatchObject({ enabledByDefault: true, strategy: 'EMAIL' });
    expect(new Set(definitions.map((source) => source.id)).size).toBe(
      definitions.length,
    );
  });
});
