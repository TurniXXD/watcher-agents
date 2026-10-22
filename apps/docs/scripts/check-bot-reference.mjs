import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const references = {
  'briefing-bot': ['apps/briefing-bot/src/bot.ts'],
  'stocks-bot': [
    'apps/stocks-bot/src/bot.ts',
    'apps/stocks-bot/src/validation-commands.ts',
  ],
  'publications-bot': ['apps/publications-bot/src/bot.ts'],
  'news-bot': ['apps/news-bot/src/bot.ts'],
  'reality-bot': ['apps/reality-bot/src/bot.ts'],
  'osint-bot': ['apps/osint-bot/src/bot.ts'],
  'sales-bot': [
    'apps/sales-bot/src/bot.ts',
    'packages/contact-network/src/telegram.ts',
  ],
  'networking-bot': [
    'apps/networking-bot/src/bot.ts',
    'packages/contact-network/src/telegram.ts',
  ],
  'jobs-bot': ['apps/jobs-bot/src/bot.ts'],
  'socials-bot': ['apps/socials-bot/src/bot.ts'],
  'study-bot': ['apps/study-bot/src/bot.ts'],
  'transport-bot': ['apps/transport-bot/src/bot.ts'],
  'maintenance-agent': ['apps/maintenance-agent/src/telegram.ts'],
};

const pageNames = { 'jobs-bot': 'jobs' };
const repositoryRoot = path.resolve('../..');
const docsRoot = path.join(repositoryRoot, 'apps/docs/content/docs/bots');
const failures = [];

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : Promise.resolve([target]);
    }),
  );
  return files.flat();
};

for (const [app, commandFiles] of Object.entries(references)) {
  const page = await readFile(
    path.join(docsRoot, `${pageNames[app] ?? app}.mdx`),
    'utf8',
  );
  const commandSource = (
    await Promise.all(
      commandFiles.map((file) =>
        readFile(path.join(repositoryRoot, file), 'utf8'),
      ),
    )
  ).join('\n');
  const commandArguments = [
    ...commandSource.matchAll(
      /bot\.command\(\s*(\[[^\]]+\]|"[^"]+"|'[^']+')/gu,
    ),
  ];
  const commands = new Set(
    commandArguments.flatMap(([, argument = '']) =>
      [...argument.matchAll(/["']([a-z][a-z0-9_]*)["']/gu)].map(
        (match) => match[1],
      ),
    ),
  );
  for (const command of commands) {
    if (!page.includes(`/${command}`)) {
      failures.push(`${app}: missing command /${command}`);
    }
  }

  const sourceRoot = path.join(repositoryRoot, 'apps', app, 'src');
  const environmentFiles = (await walk(sourceRoot)).filter((file) =>
    ['env.ts', 'config.ts'].includes(path.basename(file)),
  );
  const environmentSource = (
    await Promise.all(environmentFiles.map((file) => readFile(file, 'utf8')))
  ).join('\n');
  const variables = new Set(
    [...environmentSource.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gmu)].map(
      (match) => match[1],
    ),
  );
  variables.delete('CANDIDATE_PROFILE');
  for (const variable of variables) {
    if (!page.includes(`\`${variable}\``)) {
      failures.push(`${app}: missing environment variable ${variable}`);
    }
  }

  if (!/^## (?:Sources and integrations|Integrations)$/gmu.test(page)) {
    failures.push(`${app}: missing sources/integrations section`);
  }
}

if (failures.length) {
  process.stderr.write(
    `Incomplete bot documentation:\n${failures.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Validated commands, environment variables, and integrations for ${Object.keys(references).length} bot pages.\n`,
  );
}
