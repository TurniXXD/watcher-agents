import { describe, expect, it } from 'vitest';
import { planMerge, type MergeInput } from '../ingestion/merge';
import { textToLexical } from '../lib/lexical';

const base = (overrides: Partial<MergeInput> = {}): MergeInput => ({
  incoming: {
    title: 'A',
    startsAt: '2026-11-20T17:00:00.000Z',
    eventStatus: 'scheduled',
  },
  snapshot: {
    title: 'A',
    startsAt: '2026-11-20T17:00:00.000Z',
    eventStatus: 'scheduled',
  },
  editorial: {
    title: 'A',
    startsAt: '2026-11-20T17:00:00.000Z',
    eventStatus: 'scheduled',
  },
  reviewStatus: 'ingested',
  livePublished: false,
  criticalFields: ['startsAt', 'endsAt', 'eventStatus'],
  ...overrides,
});

describe('planMerge', () => {
  it('ignores identical submissions', () => {
    expect(planMerge(base())).toEqual({ kind: 'unchanged' });
  });

  it('auto-applies untouched fields on unreviewed drafts', () => {
    const plan = planMerge(
      base({ incoming: { ...base().incoming, title: 'B' } }),
    );
    expect(plan).toMatchObject({
      kind: 'changed',
      autoApply: { title: 'B' },
      proposals: {},
      critical: false,
    });
  });

  it('never overwrites human-edited fields', () => {
    const plan = planMerge(
      base({
        incoming: { ...base().incoming, title: 'B' },
        editorial: { ...base().editorial, title: 'Human' },
      }),
    );
    expect(plan).toMatchObject({
      autoApply: {},
      proposals: { title: { current: 'Human', proposed: 'B' } },
    });
  });

  it('turns changes to approved or published content into proposals', () => {
    for (const overrides of [
      { reviewStatus: 'approved' as const },
      { livePublished: true },
    ]) {
      const plan = planMerge(
        base({ ...overrides, incoming: { ...base().incoming, title: 'B' } }),
      );
      expect(plan).toMatchObject({
        autoApply: {},
        proposals: { title: { proposed: 'B' } },
      });
    }
  });

  it('applies verified cancellations to live content even over human edits', () => {
    const plan = planMerge(
      base({
        livePublished: true,
        reviewStatus: 'approved',
        incoming: { ...base().incoming, eventStatus: 'cancelled' },
        editorial: { ...base().editorial, eventStatus: 'postponed' },
      }),
    );
    expect(plan).toMatchObject({
      autoApply: { eventStatus: 'cancelled' },
      liveCorrections: { eventStatus: 'cancelled' },
      overrides: ['eventStatus'],
    });
  });

  it('corrects untouched dates live but flags conflicting human-edited dates as critical', () => {
    const moved = { ...base().incoming, startsAt: '2026-11-21T17:00:00.000Z' };
    const untouched = planMerge(
      base({ livePublished: true, reviewStatus: 'approved', incoming: moved }),
    );
    expect(untouched).toMatchObject({
      liveCorrections: { startsAt: moved.startsAt },
      critical: false,
    });
    const conflicting = planMerge(
      base({
        livePublished: true,
        reviewStatus: 'approved',
        incoming: moved,
        editorial: {
          ...base().editorial,
          startsAt: '2026-11-22T17:00:00.000Z',
        },
      }),
    );
    expect(conflicting).toMatchObject({
      autoApply: {},
      liveCorrections: {},
      critical: true,
    });
  });

  it('only refreshes the snapshot for rejected content', () => {
    const plan = planMerge(
      base({
        reviewStatus: 'rejected',
        incoming: { ...base().incoming, title: 'B' },
      }),
    );
    expect(plan).toMatchObject({
      kind: 'changed',
      autoApply: {},
      proposals: {},
    });
  });

  it('compares rich text by its text content', () => {
    const plan = planMerge(
      base({
        incoming: { description: textToLexical('Same text') },
        snapshot: { description: textToLexical('Same text') },
        editorial: {
          description: {
            root: { ...textToLexical('Same text').root, direction: null },
          },
        },
        richTextFields: ['description'],
      }),
    );
    expect(plan).toEqual({ kind: 'unchanged' });
  });
});
