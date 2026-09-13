import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_ITEMS_PER_RUN_CAP,
  publicationItemsPerRunLimit,
} from '../watcher.js';

describe('publications watcher run limit', () => {
  it('enforces the 15-item hard cap when analysis is otherwise unlimited', () => {
    expect(publicationItemsPerRunLimit(0)).toBe(PUBLICATION_ITEMS_PER_RUN_CAP);
    expect(PUBLICATION_ITEMS_PER_RUN_CAP).toBe(15);
  });

  it('allows a lower configured limit but never more than the hard cap', () => {
    expect(publicationItemsPerRunLimit(5)).toBe(5);
    expect(publicationItemsPerRunLimit(100)).toBe(15);
  });
});
