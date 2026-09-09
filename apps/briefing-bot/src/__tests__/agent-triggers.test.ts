import { describe, expect, it, vi } from 'vitest';
import {
  AgentTriggerError,
  AgentTriggerService,
  type WatcherRunRequester,
} from '../agent-triggers.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const requester = (
  status: 'QUEUED' | 'BUSY' | 'DISABLED' | 'NOT_CONFIGURED' = 'QUEUED',
): WatcherRunRequester => ({
  requestWatcherRun: vi.fn(async () => ({ status })),
});

describe('AgentTriggerService', () => {
  it('queues watcher bots through their persisted scheduler', async () => {
    const watchers = requester();
    const service = new AgentTriggerService({ watchers });

    await expect(service.trigger(42n, 'publications')).resolves.toEqual({
      status: 'QUEUED',
      message: '✅ medical is queued to run on its next scheduler tick.',
    });
    expect(watchers.requestWatcherRun).toHaveBeenCalledWith(42n, 'medical');
  });

  it('reports paused watcher bots instead of silently queuing them', async () => {
    const service = new AgentTriggerService({
      watchers: requester('DISABLED'),
    });

    await expect(service.trigger(42n, 'news')).rejects.toThrow(
      'news is paused',
    );
  });

  it('runs one Brno source through the authenticated search and evaluation API', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: 'success',
        results: [
          {
            source: 'goout',
            status: 'success',
            fetched: 12,
            created: 3,
            updated: 2,
            duplicates: 7,
            durationMs: 50,
          },
        ],
      }),
    );
    const service = new AgentTriggerService({
      watchers: requester(),
      brnoEvents: { baseUrl: 'http://brno-events-agent:4020', token: 'secret' },
      fetcher,
    });

    const result = await service.trigger(42n, 'brno-events', 'GoOut');

    expect(result.status).toBe('SUCCESS');
    expect(result.message).toContain(
      'Brno Events search and evaluation finished',
    );
    expect(result.message).toContain(
      'goout: fetched 12, created 3, updated 2, duplicates 7',
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error('Expected URL request target');
    expect(url.href).toBe('http://brno-events-agent:4020/run/goout');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
    });
  });

  it('preserves partial Brno source failures in the Telegram result', async () => {
    const service = new AgentTriggerService({
      watchers: requester(),
      brnoEvents: { baseUrl: 'http://brno-events-agent:4020', token: 'secret' },
      fetcher: vi.fn<typeof fetch>(async () =>
        jsonResponse({
          status: 'partial',
          results: [
            { source: 'meetup', status: 'failed', error: 'upstream offline' },
          ],
        }),
      ),
    });

    const result = await service.trigger(42n, 'brno');
    expect(result.status).toBe('PARTIAL');
    expect(result.message).toContain('meetup: failed — upstream offline');
  });

  it('understands MU Clubs busy responses returned with HTTP 409', async () => {
    const service = new AgentTriggerService({
      watchers: requester(),
      muClubs: { baseUrl: 'http://mu-clubs-monitor:4010', token: 'secret' },
      fetcher: vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            status: 'BUSY',
            sourceCount: 0,
            fetchedCount: 0,
            activityCount: 0,
            sourceFailures: [],
            briefingPublished: 0,
          },
          409,
        ),
      ),
    });

    await expect(service.trigger(42n, 'mu-clubs')).resolves.toEqual({
      status: 'BUSY',
      message: '⏳ MU Clubs is already running.',
    });
  });

  it('rejects unknown agents and invalid source IDs before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new AgentTriggerService({
      watchers: requester(),
      brnoEvents: { baseUrl: 'http://brno-events-agent:4020', token: 'secret' },
      fetcher,
    });

    await expect(service.trigger(42n, 'other')).rejects.toBeInstanceOf(
      AgentTriggerError,
    );
    await expect(
      service.trigger(42n, 'brno-events', '../health'),
    ).rejects.toThrow('Invalid Brno source ID');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
