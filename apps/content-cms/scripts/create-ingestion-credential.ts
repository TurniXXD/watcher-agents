/**
 * Creates a per-bot ingestion credential and prints the token once.
 *
 *   pnpm --filter @watcher/content-cms credentials:create -- --bot brno-events-agent --scopes events [--name "Brno events"] [--expires-days 365]
 *
 * Only the SHA-256 hash is stored. Rotate by creating a new credential,
 * deploying it to the bot, then deactivating the old one in the admin.
 */
import config from '@payload-config';
import { getPayload } from 'payload';
import { ingestibleCollections } from '../src/collections/ingestion';
import { generateCredential } from '../src/ingestion/credentials';

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const botId = argument('bot');
const scopes = (argument('scopes') ?? '')
  .split(',')
  .map((scope) => scope.trim())
  .filter(Boolean);
const expiresDays = argument('expires-days');
if (!botId || !/^[a-z0-9][a-z0-9-]{1,62}$/u.test(botId)) {
  throw new Error('--bot <lowercase-id> is required');
}
const invalid = scopes.filter(
  (scope) => !(ingestibleCollections as readonly string[]).includes(scope),
);
if (scopes.length === 0 || invalid.length > 0) {
  throw new Error(
    `--scopes must list one or more of: ${ingestibleCollections.join(', ')}`,
  );
}

const payload = await getPayload({ config });
const credential = generateCredential();
await payload.create({
  collection: 'ingestion-clients',
  data: {
    name: argument('name') ?? botId,
    botId,
    keyId: credential.keyId,
    secretHash: credential.secretHash,
    scopes: scopes as (typeof ingestibleCollections)[number][],
    active: true,
    ...(expiresDays
      ? {
          expiresAt: new Date(
            Date.now() + Number(expiresDays) * 86_400_000,
          ).toISOString(),
        }
      : {}),
  },
  overrideAccess: true,
});
process.stdout.write(
  `Created credential ${credential.keyId} for ${botId} (${scopes.join(', ')}).\n`,
);
process.stdout.write(
  'Store this token in the bot runtime env now; it is not shown again:\n',
);
process.stdout.write(`${credential.token}\n`);
await payload.destroy();
process.exit(0);
