import { describe, expect, it } from 'vitest';
import { stocksAboutPages, stocksHelp } from '../copy.js';

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
      'allocation',
      'alpaca',
      'backtest',
      'calibration',
      'catalysts',
      'dashboard',
      'decision',
      'discovery',
      'earnings',
      'event_replay',
      'health',
      'help',
      'list_sources',
      'news',
      'opportunities',
      'paper_close',
      'paper_open',
      'paper_portfolio',
      'pause',
      'peers',
      'portfolio_risk',
      'reaction',
      'reconcile',
      'remove_stock',
      'replay',
      'reset_stocks',
      'resume',
      'risk_profile',
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
      'stocks_tickers',
      'thesis',
      'validate',
      'valuation',
    ]);
  });

  it('explains the workflow and monitoring strategies in Telegram-sized pages', () => {
    const guide = stocksAboutPages.join('\n\n');

    expect(stocksAboutPages).toHaveLength(3);
    expect(stocksAboutPages.every((page) => page.length <= 4096)).toBe(true);
    expect(guide).toContain('`/add_stock MU`');
    expect(guide).toContain('`/thesis MU`');
    expect(guide).toContain('THESIS NOT READY');
    expect(guide).toContain('`CORE`');
    expect(guide).toContain('`EVENT_MODE`');
    expect(guide).toContain('`/risk_profile balanced`');
    expect(guide).toContain('Žádný z těchto příkazů neposílá obchod');
  });
});
