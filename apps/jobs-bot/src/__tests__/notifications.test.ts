import { Bot } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverJobDigest, renderJobDigest } from '../notifications.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('job notification delivery', () => {
  it('orders digest jobs by descending match score', () => {
    const digest = renderJobDigest([
      {
        notificationId: 'notification-low',
        jobId: 'job-low',
        title: 'Lower match',
        company: 'Example',
        score: 72,
        eligibility: 'ELIGIBLE',
        reasoning: 'Relevant.',
        url: 'https://example.com/low',
        source: 'Example source',
      },
      {
        notificationId: 'notification-high',
        jobId: 'job-high',
        title: 'Higher match',
        company: 'Example',
        score: 94,
        eligibility: 'ELIGIBLE',
        reasoning: 'Very relevant.',
        url: 'https://example.com/high',
        source: 'Example source',
      },
    ]);

    expect(digest.indexOf('Higher match')).toBeLessThan(
      digest.indexOf('Lower match'),
    );
  });

  it('records every provider attempt and succeeds on partial provider failure', async () => {
    const bot = new Bot('test-token');
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Jobs Bot',
      username: 'jobs_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };
    bot.api.config.use(async (_previous, method) => {
      if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
      return { ok: true, result: { message_id: 1 } } as never;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );
    const store = {
      recordNotificationDelivery: vi.fn(async () => undefined),
      markNotification: vi.fn(async () => undefined),
    };

    const delivered = await deliverJobDigest({
      bot,
      chatIds: [123n],
      store: store as never,
      jobs: [
        {
          notificationId: 'notification-1',
          jobId: 'job-1',
          title: 'TypeScript Engineer',
          company: 'Example',
          score: 91,
          eligibility: 'ELIGIBLE',
          reasoning: 'Strong TypeScript match.',
          url: 'https://example.com/jobs/1',
          source: 'Example source',
        },
      ],
      email: {
        url: 'https://mail.example/send',
        recipient: 'operator@example.com',
      },
    });

    expect(delivered).toBe(1);
    expect(store.recordNotificationDelivery).toHaveBeenCalledTimes(2);
    expect(store.recordNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'telegram', sent: true }),
    );
    expect(store.recordNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'email-webhook', sent: false }),
    );
    expect(store.markNotification).toHaveBeenCalledWith(
      'notification-1',
      true,
      undefined,
    );
  });
});
