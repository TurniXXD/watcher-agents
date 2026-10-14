import { describe, expect, it } from 'vitest';
import { renderDailyTrendReport } from '../trends/runner.js';

describe('daily trend report', () => {
  it('does not invent filler when no credible opportunities exist', () => {
    const report = renderDailyTrendReport({
      researchDate: '2026-10-14',
      opportunities: [],
      sourceStatuses: [{ source: 'YOUTUBE', availability: 'ACTIVE' }],
    });
    expect(report).toContain('nevytváří výplňová témata');
    expect(report).toContain('Naměřená fakta');
  });
});
