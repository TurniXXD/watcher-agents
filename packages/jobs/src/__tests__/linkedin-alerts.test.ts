import { describe, expect, it, vi } from 'vitest';
import { createLinkedinAlertAdapter, parseLinkedinAlert } from '../index.js';

const message = {
  from: 'jobalerts-noreply@linkedin.com',
  subject: 'Full Stack Developer jobs in Czechia',
  receivedAt: new Date('2026-10-28T08:00:00Z'),
  html: `
    <table><tr><td>
      <a href="https://www.linkedin.com/comm/jobs/view/123456/?trk=email"><strong>Full Stack Developer</strong></a>
      <p>Example s.r.o.</p><p>Prague, Czechia</p>
    </td></tr></table>
    <a href="https://www.linkedin.com/jobs/view/123456/">View job</a>
  `,
};

describe('LinkedIn email-alert source', () => {
  it('normalizes and deduplicates job links without fetching LinkedIn', () => {
    expect(parseLinkedinAlert(message)).toMatchObject([
      {
        externalId: '123456',
        sourceId: 'linkedin',
        title: 'Full Stack Developer',
        company: 'Example s.r.o.',
        country: 'Czechia',
        originalUrl: 'https://www.linkedin.com/jobs/view/123456/',
      },
    ]);
  });

  it('rejects lookalike senders and unrelated links', () => {
    expect(
      parseLinkedinAlert({ ...message, from: 'alerts@linkedin.com.evil.test' }),
    ).toEqual([]);
    expect(
      parseLinkedinAlert({
        ...message,
        html: '<a href="https://example.com/jobs/view/123456/">Full Stack Developer</a>',
      }),
    ).toEqual([]);
  });

  it('uses injected mailbox reading and has no network dependency in tests', async () => {
    const readMessages = vi.fn().mockResolvedValue([message]);
    const source = createLinkedinAlertAdapter(readMessages);
    expect((await source.discover({})).jobs).toHaveLength(1);
    expect(readMessages).toHaveBeenCalledOnce();
    expect(source.strategy).toBe('EMAIL');
  });
});
