import { describe, expect, it } from 'vitest';
import { TwentyIntegration } from '../integrations/twenty/index.js';

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const requestUrl = (request: RequestInfo | URL): string =>
  typeof request === 'string'
    ? request
    : request instanceof URL
      ? request.href
      : request.url;

describe('TwentyIntegration idempotence', () => {
  it('creates a company once and updates the same domain on the next upsert', async () => {
    let companyId: string | undefined;
    let creates = 0;
    const fetcher: typeof fetch = async (request, init) => {
      const url = requestUrl(request);
      if (init?.method === 'POST') {
        creates += 1;
        companyId = 'company-1';
        return json({ data: { company: { id: companyId } } });
      }
      if (init?.method === 'PATCH') {
        return json({ data: { company: { id: companyId } } });
      }
      if (url.includes('domainName.primaryLinkUrl') && companyId) {
        return json({ data: { companies: [{ id: companyId }] } });
      }
      return json({ data: { companies: [] } });
    };
    const twenty = new TwentyIntegration(
      'https://twenty.example',
      'test-key',
      false,
      fetcher,
    );
    const input = {
      name: 'Example',
      websiteUrl: 'https://www.example.cz/path',
      domain: 'www.example.cz',
      source: 'TEST',
      lastResearchedAt: new Date('2026-10-03T10:00:00Z'),
    };
    expect((await twenty.upsertCompany(input)).id).toBe('company-1');
    expect((await twenty.upsertCompany(input)).id).toBe('company-1');
    expect(creates).toBe(1);
  });

  it('creates a person once and reuses the normalized email', async () => {
    let personId: string | undefined;
    let creates = 0;
    const fetcher: typeof fetch = async (request, init) => {
      const url = requestUrl(request);
      if (init?.method === 'POST') {
        creates += 1;
        personId = 'person-1';
        return json({ data: { person: { id: personId } } });
      }
      if (init?.method === 'PATCH') {
        return json({ data: { person: { id: personId } } });
      }
      if (url.includes('emails.primaryEmail') && personId) {
        return json({ data: { people: [{ id: personId }] } });
      }
      return json({ data: { people: [] } });
    };
    const twenty = new TwentyIntegration(
      'https://twenty.example',
      'test-key',
      false,
      fetcher,
    );
    const input = {
      firstName: 'Jana',
      lastName: 'Nováková',
      email: 'JANA@EXAMPLE.CZ',
      companyId: 'company-1',
      source: 'TEST',
    };
    await twenty.upsertPerson(input);
    await twenty.upsertPerson(input);
    expect(creates).toBe(1);
  });

  it('does not create a duplicate relationship', async () => {
    let relationshipId: string | undefined;
    let creates = 0;
    const fetcher: typeof fetch = async (_request, init) => {
      if (init?.method === 'POST') {
        creates += 1;
        relationshipId = 'relationship-1';
        return json({ data: { salesRelationship: { id: relationshipId } } });
      }
      return json({
        data: {
          salesRelationships: relationshipId ? [{ id: relationshipId }] : [],
        },
      });
    };
    const twenty = new TwentyIntegration(
      'https://twenty.example',
      'test-key',
      true,
      fetcher,
    );
    const input = {
      fromPersonId: 'person-1',
      toPersonId: 'person-2',
      type: 'KNOWS',
    };
    await twenty.createRelationship(input);
    await twenty.createRelationship(input);
    expect(creates).toBe(1);
  });
});
