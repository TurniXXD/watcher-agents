import openapiTS, { astToString } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';
import { buildIngestOpenApi, buildPublicOpenApi } from '../openapi/build';

const collectRefs = (value: unknown, refs: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((entry) => collectRefs(entry, refs));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') refs.push(entry);
      else collectRefs(entry, refs);
    }
  }
  return refs;
};

describe('OpenAPI documents', () => {
  const publicSpec = buildPublicOpenApi('https://cms.vantuch.dev');
  const ingestSpec = buildIngestOpenApi('https://cms.vantuch.dev');

  it('describes every public endpoint with title, version, and resolvable refs', () => {
    expect(publicSpec).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Vantuch Content API', version: '1.0.0' },
    });
    expect(Object.keys(publicSpec.paths).sort()).toEqual(
      [
        '/public/v1/articles',
        '/public/v1/articles/{slug}',
        '/public/v1/events',
        '/public/v1/events/categories',
        '/public/v1/events/featured',
        '/public/v1/events/{slug}',
        '/public/v1/news',
        '/public/v1/publications',
      ].sort(),
    );
    const schemas = publicSpec.components.schemas;
    for (const ref of collectRefs(publicSpec)) {
      expect(schemas, ref).toHaveProperty(
        ref.replace('#/components/schemas/', ''),
      );
    }
    const parameters = publicSpec.paths['/public/v1/events'].get.parameters.map(
      (parameter) => parameter.name,
    );
    expect(parameters).toEqual([
      'city',
      'category',
      'from',
      'to',
      'q',
      'limit',
      'cursor',
      'sort',
      'free',
      'freeFood',
      'featured',
    ]);
    expect(JSON.stringify(schemas.PublicEvent)).toContain('freeFood');
  });

  it('documents ingestion authentication, schemas, and errors', () => {
    expect(ingestSpec.components.securitySchemes.botToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(Object.keys(ingestSpec.paths)).toHaveLength(6);
    const responses = ingestSpec.paths['/ingest/v1/events'].post.responses;
    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '413', '429']),
    );
    for (const ref of collectRefs(ingestSpec)) {
      expect(ingestSpec.components.schemas, ref).toHaveProperty(
        ref.replace('#/components/schemas/', ''),
      );
    }
  });

  it('generates TypeScript with openapi-typescript', async () => {
    for (const spec of [publicSpec, ingestSpec]) {
      const output = astToString(
        await openapiTS(JSON.parse(JSON.stringify(spec)) as never),
      );
      expect(output).toContain('export interface paths');
    }
    const output = astToString(
      await openapiTS(JSON.parse(JSON.stringify(publicSpec)) as never),
    );
    expect(output).toMatch(/freeFood: "yes" \| "no" \| "unknown"/u);
  });
});
