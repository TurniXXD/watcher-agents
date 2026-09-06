import type { PipelineResult } from '@watcher/core';
import { describe, expect, it } from 'vitest';
import {
  hasReportableStockInformation,
  reportableStockResult,
} from '../run-output.js';

const result = (overrides: Partial<PipelineResult> = {}): PipelineResult => ({
  fetchedCount: 0,
  newItemCount: 0,
  analyzedCount: 0,
  failedAnalysisCount: 0,
  sourceFailures: [],
  analyses: [],
  ...overrides,
});

describe('stock run output', () => {
  it('does not report provider failures without useful stock information', () => {
    expect(
      hasReportableStockInformation(
        result({
          sourceFailures: [
            {
              source: 'NEWS',
              target: 'MU',
              message: 'RATE_LIMITED provider backoff active',
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('reports a non-duplicate event even when it required no LLM analysis', () => {
    expect(
      hasReportableStockInformation(
        result({
          intelligence: {
            newEventCount: 1,
            duplicateEventCount: 0,
            storedOnlyCount: 1,
            cooldownCount: 0,
            events: [
              {
                eventId: 'event-1',
                ticker: 'MU',
                eventType: 'FILING',
                title: 'Micron filing',
                materiality: 'LOW',
                action: 'STORE',
                decision: 'STORED',
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it('removes operational failures from a reportable digest', () => {
    const cleaned = reportableStockResult(
      result({
        failedAnalysisCount: 1,
        sourceFailures: [{ source: 'NEWS', target: 'MU', message: 'HTTP 429' }],
        analyses: [
          {
            item: {
              id: 'SEC:failed',
              source: 'SEC',
              externalId: 'failed',
              title: 'Failed filing',
              url: 'https://www.sec.gov/failed',
              content: 'content',
              metadata: {},
            },
            outcome: { status: 'FAILED', error: 'Malformed model output' },
          },
        ],
      }),
    );

    expect(cleaned.sourceFailures).toEqual([]);
    expect(cleaned.analyses).toEqual([]);
    expect(cleaned.failedAnalysisCount).toBe(0);
  });
});
