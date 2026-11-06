/**
 * Writes the OpenAPI 3.1 documents for client generation:
 *
 *   pnpm --filter @watcher/content-cms openapi:export [-- --server https://cms.vantuch.dev] [--out openapi]
 *   npx openapi-typescript apps/content-cms/openapi/public.json -o src/lib/content-api.d.ts
 *
 * No database or secrets are required.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIngestOpenApi, buildPublicOpenApi } from '../src/openapi/build';

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const server =
  argument('server') ?? process.env.SERVER_URL ?? 'https://cms.vantuch.dev';
const outDir = path.resolve(argument('out') ?? 'openapi');
await mkdir(outDir, { recursive: true });
for (const [name, document] of [
  ['public.json', buildPublicOpenApi(server)],
  ['ingest.json', buildIngestOpenApi(server)],
] as const) {
  const target = path.join(outDir, name);
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`Wrote ${target}\n`);
}
