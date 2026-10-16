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

  it('shows actionable source diagnostics without inventing data', () => {
    const report = renderDailyTrendReport({
      researchDate: '2026-10-15',
      opportunities: [],
      sourceStatuses: [
        {
          source: 'YOUTUBE',
          availability: 'ERROR',
          error:
            'YouTube API returned HTTP 403: quotaExceeded — YouTube quota is exhausted',
        },
      ],
    });
    expect(report).toContain('Diagnostika zdrojů:');
    expect(report).toContain('quotaExceeded');
    expect(report).toContain('nevytváří výplňová témata');
  });
});
