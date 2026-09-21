import { describe, expect, it } from 'vitest';
import { renderThesisNotReady } from '../thesis-refresh.js';

describe('renderThesisNotReady', () => {
  it('explains the evidence gate and gives specific recovery guidance', () => {
    const text = renderThesisNotReady('MU', {
      durationMs: 85_000,
      fetchedCount: 25,
      duplicatesRemoved: 7,
      newItemCount: 0,
      analyzedCount: 0,
      failedAnalysisCount: 2,
      analyses: [
        {
          item: {
            id: 'NEWS:1',
            source: 'NEWS',
            externalId: '1',
            title: 'MU update',
            url: 'https://example.com/1',
            content: 'update',
            metadata: { symbol: 'MU' },
          },
          outcome: { status: 'FAILED', error: 'timed out' },
        },
        {
          item: {
            id: 'SEC:1',
            source: 'SEC',
            externalId: '1',
            title: 'MU filing',
            url: 'https://example.com/2',
            content: 'filing',
            metadata: { symbol: 'MU' },
          },
          outcome: { status: 'FAILED', error: 'invalid output' },
        },
      ],
      sourceFailures: [
        { source: 'EARNINGS_WHISPERS', target: 'MU', message: 'fetch failed' },
      ],
      dataCoverage: {
        expectedSources: 13,
        successfulSources: 12,
        unavailableSources: 1,
        percentage: 92,
      },
      intelligence: {
        events: [],
        newEventCount: 0,
        duplicateEventCount: 4,
        storedOnlyCount: 2,
        cooldownCount: 0,
        eventsCreated: 0,
        eventsAnalyzed: 0,
      },
    });

    expect(text).toContain('THESIS NOT READY · MU');
    expect(text).toContain('1m 25s');
    expect(text).toContain('did not create a usable canonical company event');
    expect(text).toContain('2 analysis attempts failed (NEWS, SEC)');
    expect(text).toContain('EARNINGS_WHISPERS');
    expect(text).toContain(
      'Historical snapshots alone are intentionally not promoted',
    );
    expect(text).toContain('More waiting would not by itself fix this run');
    expect(text).toContain('run /thesis MU');
  });
});
