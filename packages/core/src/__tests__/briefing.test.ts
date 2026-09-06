import { describe, expect, it } from 'vitest';
import {
  briefingEventSchema,
  getWatcherRegistration,
  registeredWatcherBots,
} from '../briefing.js';

const validEvent = {
  id: 'stocks:canonical-event-1',
  watcherBot: 'stocks',
  externalEventId: 'canonical-event-1',
  occurredAt: '2026-09-05T06:00:00.000Z',
  publishedAt: '2026-09-05T06:05:00.000Z',
  detectedAt: '2026-09-05T06:06:00.000Z',
  createdAt: '2026-09-05T06:06:00.000Z',
  updatedAt: '2026-09-05T06:06:00.000Z',
  category: 'STOCK_CATALYST',
  title: 'Material clinical catalyst',
  summary: 'A material catalyst changed the monitored company thesis.',
  importance: 90,
  novelty: 100,
  relevance: 85,
  urgency: 75,
  actionable: true,
  action: 'Review before market open',
  entities: [{ type: 'company', name: 'Example Corp', ticker: 'EXM' }],
  tags: ['clinical'],
  sourceUrls: ['https://example.com/event/1'],
  primarySource: 'SEC',
  confidence: 'HIGH',
  status: 'NEW',
  deduplicationKey: 'EXM:clinical:event-1',
  relatedEventIds: [],
  metadata: { studyPhase: 3, humanStudy: true },
} as const;

describe('briefing event contract', () => {
  it('accepts a registered, JSON-safe event', () => {
    expect(briefingEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('rejects unregistered watcher ids', () => {
    expect(() =>
      briefingEventSchema.parse({ ...validEvent, watcherBot: 'weather' }),
    ).toThrow();
  });

  it('rejects categories owned by a different watcher', () => {
    expect(() =>
      briefingEventSchema.parse({
        ...validEvent,
        watcherBot: 'medical',
        category: 'STOCK_CATALYST',
      }),
    ).toThrow(/not registered for medical/);
  });

  it('rejects malformed scores, timestamps, URLs, and metadata', () => {
    expect(() =>
      briefingEventSchema.parse({
        ...validEvent,
        importance: 101,
        detectedAt: 'today',
        sourceUrls: ['not-a-url'],
        metadata: { invalid: 1n },
      }),
    ).toThrow();
  });

  it('exposes only the two implemented producers in the registry', () => {
    expect(registeredWatcherBots).toEqual(['stocks', 'medical']);
    expect(getWatcherRegistration('stocks')).toMatchObject({
      displayName: 'Stocks',
      producerKind: 'STOCKS',
    });
    expect(getWatcherRegistration('medical')).toMatchObject({
      displayName: 'Medical',
      producerKind: 'PUBLICATIONS',
    });
  });
});
