import { describe, expect, it } from 'vitest';
import { stocksAbout, stocksHelp } from '../copy.js';

const commandNames = (help: string): string[] =>
  help
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((line) => line.match(/^\/([a-z_]+)/)?.[1] ?? '');

describe('stocks bot command copy', () => {
  it('lists every help command alphabetically', () => {
    const commands = commandNames(stocksHelp);

    expect(commands).toEqual([...commands].sort());
    expect(commands).toEqual([
      'about',
      'add_stock',
      'advanced',
      'alerts',
      'backtest',
      'calibration',
      'catalysts',
      'dashboard',
      'discovery',
      'event_replay',
      'health',
      'help',
      'list_sources',
      'opportunities',
      'pause',
      'reconcile',
      'remove_stock',
      'replay',
      'resume',
      'run',
      'run_discovery',
      'schedule',
      'schedule_add',
      'schedule_list',
      'schedule_remove',
      'set_mode',
      'set_priority',
      'set_tier',
      'signal_performance',
      'sources',
      'start',
      'status',
      'stock_off',
      'stock_on',
      'stocks',
      'thesis',
      'validate',
    ]);
  });

  it('keeps the Markdown about message detailed and Telegram-sized', () => {
    expect(stocksAbout).toContain('*What it does*');
    expect(stocksAbout).toContain('*Key advantages*');
    expect(stocksAbout).toContain('*How to use it*');
    expect(stocksAbout).toContain('`/add_stock SYMBOL`');
    expect(stocksAbout.length).toBeLessThanOrEqual(4096);
  });
});
