import { describe, expect, it } from 'vitest';
import { maintenanceAbout } from '../telegram.js';

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
});
