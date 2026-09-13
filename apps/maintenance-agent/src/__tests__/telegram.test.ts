import { describe, expect, it } from 'vitest';
import { maintenanceAbout, renderRecommendations } from '../telegram.js';

describe('maintenance Telegram copy', () => {
  it('explains the agent purpose and non-mutating safety boundary', () => {
    expect(maintenanceAbout).toContain('private operational observer');
    expect(maintenanceAbout).toContain('probes live service health');
    expect(maintenanceAbout).toContain('monitors server CPU, RAM, and GPU');
    expect(maintenanceAbout).toContain('never edits configuration');
    expect(maintenanceAbout).toContain('never');
    expect(maintenanceAbout).toContain('deploys code');
    expect(maintenanceAbout).toContain(
      'Approval through the authenticated API records a human decision only.',
    );
  });

  it('renders current recommendation evidence without implying application', () => {
    const rendered = renderRecommendations([
      {
        agentName: 'news-bot',
        title: 'Repair NEWS_RSS',
        confidence: 0.94,
        finding: { description: 'Four of five current requests failed.' },
      },
    ]);

    expect(rendered).toContain('Current maintenance recommendations');
    expect(rendered).toContain('Four of five current requests failed.');
    expect(rendered).toContain('94%');
    expect(rendered).toContain('never applies a change automatically');
  });
});
