import { describe, expect, it } from 'vitest';
import { stocksAbout, stocksHelp } from '../copy.js';

const commandNames = (help: string): string[] =>
  help
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((line) => line.match(/^\/([a-z]+)/)?.[1] ?? '');

describe('stocks bot command copy', () => {
  it('lists every help command alphabetically', () => {
    const commands = commandNames(stocksHelp);

    expect(commands).toEqual([...commands].sort());
    expect(commands).toEqual([
      'about',
      'addstock',
      'advanced',
      'alerts',
      'backtest',
      'calibration',
      'catalysts',
      'dashboard',
      'discovery',
      'eventreplay',
      'health',
      'help',
      'listsources',
      'opportunities',
      'pause',
      'reconcile',
      'removestock',
      'replay',
      'resume',
      'run',
      'rundiscovery',
      'schedule',
      'setmode',
      'setpriority',
      'settier',
      'signalperformance',
      'sources',
      'start',
      'status',
      'stockoff',
      'stockon',
      'stocks',
      'thesis',
      'validate',
    ]);
  });

  it('keeps the Markdown about message detailed and Telegram-sized', () => {
    expect(stocksAbout).toContain('*What it does*');
    expect(stocksAbout).toContain('*Key advantages*');
    expect(stocksAbout).toContain('*How to use it*');
    expect(stocksAbout).toContain('`/addstock SYMBOL`');
    expect(stocksAbout.length).toBeLessThanOrEqual(4096);
  });
});
