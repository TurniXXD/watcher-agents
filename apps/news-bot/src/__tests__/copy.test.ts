import { describe, expect, it } from 'vitest';
import { newsAbout, newsHelp } from '../copy.js';

describe('news bot copy', () => {
  it('keeps help commands alphabetized', () => {
    const commands = newsHelp
      .split('\n')
      .filter((line) => line.startsWith('/'))
      .map((line) => line.split(' ', 1)[0]);
    expect(commands).toEqual([...commands].sort());
  });

  it('documents both profiles and briefing integration', () => {
    expect(newsAbout).toContain('*Czech*');
    expect(newsAbout).toContain('*Global*');
    expect(newsAbout).toContain('Personal Morning Briefing Bot');
    expect(newsAbout).toContain('/feed_add');
  });
});
