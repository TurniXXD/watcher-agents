import { describe, expect, it } from 'vitest';
import { publicationsAbout, publicationsHelp } from '../copy.js';

const commandNames = (help: string): string[] =>
  help
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((line) => line.match(/^\/([a-z_]+)/)?.[1] ?? '');

describe('publications bot command copy', () => {
  it('lists every help command alphabetically', () => {
    const commands = commandNames(publicationsHelp);

    expect(commands).toEqual([...commands].sort());
    expect(commands).toEqual([
      'about',
      'add_queries',
      'add_query',
      'help',
      'list_sources',
      'pause',
      'queries',
      'remove_query',
      'resume',
      'run',
      'schedule',
      'sources',
      'start',
      'status',
    ]);
  });

  it('keeps the Markdown about message detailed and Telegram-sized', () => {
    expect(publicationsAbout).toContain('*What it does*');
    expect(publicationsAbout).toContain('*Key advantages*');
    expect(publicationsAbout).toContain('*How to use it*');
    expect(publicationsAbout).toContain('`/add_query TOPIC`');
    expect(publicationsAbout.length).toBeLessThanOrEqual(4096);
  });
});
