import { describe, expect, it } from 'vitest';
import { renderWeeklyDiscoveryReport } from '../discovery-report.js';

describe('renderWeeklyDiscoveryReport', () => {
  it('keeps scheduled reports below Telegram message limits', () => {
    const report = renderWeeklyDiscoveryReport(
      Array.from({ length: 50 }, (_, index) => ({
        ticker: `TEST${index}`,
        companyName: 'Example company',
        changePercent: 2.5,
        attentionScore: 80,
        reason: 'A material market signal was detected during discovery.',
      })),
    );

    expect(report.length).toBeLessThanOrEqual(4_096);
    expect(report).toContain('Nothing was added to your watchlist.');
  });

  it('renders the no-candidate result without an empty list', () => {
    expect(renderWeeklyDiscoveryReport([])).toContain(
      'No candidates met the quality filters this week.',
    );
  });
});
