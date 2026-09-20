import { describe, expect, it } from 'vitest';
import { NEWS_ITEMS_PER_RUN_CAP, newsItemsPerRunLimit } from '../watcher.js';

describe('news processing budget', () => {
  it('bounds an unlimited configured run to a small analysis batch', () => {
    expect(newsItemsPerRunLimit(0)).toBe(NEWS_ITEMS_PER_RUN_CAP);
    expect(newsItemsPerRunLimit(3)).toBe(3);
    expect(newsItemsPerRunLimit(100)).toBe(NEWS_ITEMS_PER_RUN_CAP);
  });
});
