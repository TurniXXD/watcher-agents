import {
  briefingEventSchema,
  type BriefingEventRepository,
  type PipelineResult,
} from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  earningsReminderBriefingEvents,
  publishEarningsReminderBriefingEvents,
  publishStockBriefingEvents,
  stockBriefingEvents,
} from '../briefing-publisher.js';

const result = (): PipelineResult => ({
  fetchedCount: 1,
  newItemCount: 1,
  analyzedCount: 1,
  failedAnalysisCount: 0,
  sourceFailures: [],
  analyses: [
    {
      item: {
        id: 'SEC:filing-1',
        source: 'SEC',
        externalId: 'filing-1',
        title: 'Material filing',
        url: 'https://www.sec.gov/Archives/example',
        publishedAt: new Date('2026-09-05T06:00:00.000Z'),
        content: 'Material filing content',
        metadata: { symbol: 'MRK', target: 'MRK — Merck' },
      },
      outcome: {
        status: 'SUCCESS',
        result: {
          title: 'Trial catalyst',
          summary: 'The trial result materially changes the company thesis.',
          importance: 9,
          sentiment: 'positive',
          eventType: 'CLINICAL_TRIAL',
          positives: ['Primary endpoint met'],
          negatives: [],
          risks: [],
          catalysts: ['Regulatory submission'],
          confidence: 0.9,
        },
      },
    },
  ],
  intelligence: {
    events: [
      {
        eventId: 'canonical-1',
        ticker: 'MRK',
        eventType: 'CLINICAL_TRIAL',
        title: 'Phase III trial succeeded',
        materiality: 'EXTREME',
        action: 'IMMEDIATE_ANALYSIS',
        decision: 'ANALYZE',
        direction: 'POSITIVE',
      },
      {
        eventId: 'canonical-low',
        ticker: 'MRK',
        eventType: 'OTHER',
        title: 'Minor update',
        materiality: 'LOW',
        action: 'STORE',
        decision: 'STORED',
      },
    ],
    newEventCount: 1,
    duplicateEventCount: 0,
    storedOnlyCount: 1,
    cooldownCount: 0,
  },
});

describe('stock briefing publisher', () => {
  it('maps only meaningful analyzed canonical events', () => {
    const events = stockBriefingEvents(
      result(),
      new Date('2026-09-05T07:00:00.000Z'),
    );

    expect(events).toHaveLength(1);
    expect(briefingEventSchema.parse(events[0])).toMatchObject({
      id: 'stocks:canonical-1',
      category: 'STOCK_CATALYST',
      importance: 100,
      actionable: true,
      entities: [{ name: 'Merck', ticker: 'MRK' }],
      confidence: 'HIGH',
    });
  });

  it('isolates one event publication failure from the producer run', async () => {
    const save = vi.fn(async () => Promise.reject(new Error('unavailable')));
    const repository: BriefingEventRepository = {
      save,
      list: vi.fn(async () => []),
    };

    await expect(
      publishStockBriefingEvents(repository, result()),
    ).resolves.toEqual({ published: 0, failed: 1 });
    expect(save).toHaveBeenCalledOnce();
  });

  it('creates earnings reminders one week and one day before a confirmed report date', () => {
    const catalysts = [
      {
        id: 'catalyst-1',
        ticker: 'MU',
        companyName: 'Micron Technology, Inc.',
        description: 'Confirmed quarterly earnings report',
        expectedStart: new Date('2026-09-30T20:00:00.000Z'),
        exactDateKnown: true,
        impact: 'HIGH',
        source: 'EARNINGS_WHISPERS',
        sourceUrl: 'https://www.earningswhispers.com/stocks/MU',
      },
    ];

    const weekBefore = earningsReminderBriefingEvents(
      catalysts,
      new Date('2026-09-23T05:00:00.000Z'),
      'Europe/Prague',
    );
    const dayBefore = earningsReminderBriefingEvents(
      catalysts,
      new Date('2026-09-29T05:00:00.000Z'),
      'Europe/Prague',
    );
    const otherDay = earningsReminderBriefingEvents(
      catalysts,
      new Date('2026-09-28T05:00:00.000Z'),
      'Europe/Prague',
    );

    expect(weekBefore).toHaveLength(1);
    expect(dayBefore).toHaveLength(1);
    expect(otherDay).toHaveLength(0);
    expect(briefingEventSchema.parse(weekBefore[0])).toMatchObject({
      id: 'stocks:earnings-reminder:MU:2026-09-30:7d',
      category: 'STOCK_EARNINGS',
      subcategory: 'EARNINGS_REMINDER',
      importance: 65,
      urgency: 60,
      actionable: true,
      entities: [{ name: 'Micron Technology, Inc.', ticker: 'MU' }],
      tags: ['EARNINGS', 'EARNINGS_REMINDER', '7D_BEFORE'],
      deduplicationKey: 'stocks:earnings-reminder:MU:2026-09-30:7d',
      relatedEventIds: ['catalyst-1'],
    });
    expect(dayBefore[0]).toMatchObject({
      importance: 75,
      urgency: 85,
      tags: ['EARNINGS', 'EARNINGS_REMINDER', '1D_BEFORE'],
    });
  });

  it('publishes earnings reminders through the briefing repository', async () => {
    const save = vi.fn(async (rawEvent: unknown) => ({
      created: true,
      event: briefingEventSchema.parse(rawEvent),
    }));
    const repository: BriefingEventRepository = {
      save,
      list: vi.fn(async () => []),
    };

    await expect(
      publishEarningsReminderBriefingEvents(
        repository,
        [
          {
            id: 'catalyst-1',
            ticker: 'MU',
            companyName: null,
            description: 'Confirmed quarterly earnings report',
            expectedStart: new Date('2026-09-30T20:00:00.000Z'),
            exactDateKnown: true,
            impact: 'HIGH',
            source: 'EARNINGS_WHISPERS',
            sourceUrl: 'https://www.earningswhispers.com/stocks/MU',
          },
        ],
        undefined,
        new Date('2026-09-29T05:00:00.000Z'),
        'Europe/Prague',
      ),
    ).resolves.toEqual({ published: 1, failed: 0 });
    expect(save).toHaveBeenCalledOnce();
  });
});
