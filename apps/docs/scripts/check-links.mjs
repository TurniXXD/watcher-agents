import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve('content/docs');

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

const files = (await walk(root)).filter((file) => /\.mdx?$/u.test(file));
const known = new Set(files.map((file) => path.normalize(file)));
const failures = [];

for (const file of files) {
  const content = await readFile(file, 'utf8');
  const links = [
    ...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu),
    ...content.matchAll(/href=["']([^"']+)["']/gu),
  ].map((match) => match[1]);

  for (const original of links) {
    const href = original?.split('#')[0]?.split('?')[0];
    if (!href || /^(?:https?:|mailto:|#)/u.test(href)) continue;

    let target;
    if (href.startsWith('/docs')) {
      const route = href.slice('/docs'.length).replace(/^\//u, '');
      target = path.join(root, route || 'index.mdx');
    } else {
      target = path.resolve(path.dirname(file), href);
    }

    const candidates = path.extname(target)
      ? [target]
      : [`${target}.mdx`, path.join(target, 'index.mdx')];
    if (!candidates.some((candidate) => known.has(path.normalize(candidate)))) {
      failures.push(`${path.relative(root, file)} -> ${original}`);
    }
  }
}

if (failures.length) {
  process.stderr.write(
    `Broken internal documentation links:\n${failures.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Validated internal links across ${files.length} MDX files.\n`,
  );
}
