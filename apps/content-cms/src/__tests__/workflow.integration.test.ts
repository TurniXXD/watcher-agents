import type { Payload } from 'payload';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBotToken,
  createStaff,
  endpointRequest,
  findEndpoint,
  getTestPayload,
} from './helpers/payload';

const DAY = 86_400_000;
const future = (days: number, hour = 17) => {
  const date = new Date(Date.now() + days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

type Json = Record<string, unknown>;

describe('content workflow (PostgreSQL)', () => {
  let payload: Payload;
  let token: string;
  let reviewer: Awaited<ReturnType<typeof createStaff>>;
  let editor: Awaited<ReturnType<typeof createStaff>>;

  const ingest = async (
    items: Json[],
    options: {
      token?: string;
      collection?: string;
      idempotencyKey?: string;
    } = {},
  ) => {
    const collection = options.collection ?? 'events';
    const handler = await findEndpoint(`/ingest/v1/${collection}`, 'post');
    const response = await handler(
      endpointRequest(payload, {
        method: 'POST',
        url: `https://cms.example.test/api/ingest/v1/${collection}`,
        headers: {
          authorization: `Bearer ${options.token ?? token}`,
          ...(options.idempotencyKey
            ? { 'idempotency-key': options.idempotencyKey }
            : {}),
        },
        body: { items },
      }),
    );
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Json,
    };
  };

  const publicGet = async (
    path: string,
    routeParams: Record<string, string> = {},
    query = '',
  ) => {
    const handler = await findEndpoint(path);
    const response = await handler(
      endpointRequest(payload, {
        url: `https://cms.example.test/api${path}${query}`,
        routeParams,
      }),
    );
    return { status: response.status, body: (await response.json()) as Json };
  };

  const event = (overrides: Json = {}): Json => ({
    externalId: 'evt-1',
    title: 'Brno AI Night',
    summary: 'Ai meetup in Brno.',
    startsAt: future(10),
    endsAt: future(10, 19),
    city: 'Brno',
    venueName: 'Example Hall',
    category: 'ai',
    sourceUrl: 'https://organiser.example.org/events/ai-night',
    isFree: true,
    freeFood: 'unknown',
    ...overrides,
  });

  const draftOf = (id: string) =>
    payload.findByID({
      collection: 'events',
      id,
      draft: true,
      overrideAccess: true,
      depth: 0,
    }) as unknown as Promise<Json>;

  beforeAll(async () => {
    payload = await getTestPayload();
    token = await createBotToken(payload, 'brno-events-agent', ['events']);
    reviewer = await createStaff(payload, 'reviewer');
    editor = await createStaff(payload, 'editor');
  }, 120_000);

  it('creates unpublished records and treats identical resubmissions as no-ops', async () => {
    const first = await ingest([event()]);
    expect(first.status).toBe(200);
    const result = (first.body.results as Json[])[0]!;
    expect(result.outcome).toBe('created');
    expect(result.slug).toMatch(/^brno-ai-night-\d{4}-\d{2}-\d{2}$/u);
    const id = String(result.id);
    const doc = await draftOf(id);
    expect(doc).toMatchObject({
      reviewStatus: 'ingested',
      _status: 'draft',
      sourceBot: 'brno-events-agent',
      citySlug: 'brno',
    });

    const versionsBefore = await payload.countVersions({
      collection: 'events',
      where: { parent: { equals: id } },
    });
    const second = await ingest([event()]);
    expect((second.body.results as Json[])[0]).toMatchObject({
      outcome: 'unchanged',
      id,
    });
    const versionsAfter = await payload.countVersions({
      collection: 'events',
      where: { parent: { equals: id } },
    });
    expect(versionsAfter.totalDocs).toBe(versionsBefore.totalDocs);
    expect(
      (await payload.count({ collection: 'events', overrideAccess: true }))
        .totalDocs,
    ).toBe(1);

    const listed = await publicGet('/public/v1/events');
    expect(listed.body.data).toEqual([]);
  });

  it('follows bot changes on unreviewed records but preserves human edits', async () => {
    const created = await ingest([
      event({ externalId: 'evt-2', title: 'Original title' }),
    ]);
    const id = String((created.body.results as Json[])[0]!.id);

    const autoUpdate = await ingest([
      event({ externalId: 'evt-2', title: 'Corrected title' }),
    ]);
    expect((autoUpdate.body.results as Json[])[0]!.outcome).toBe('updated');
    expect((await draftOf(id)).title).toBe('Corrected title');

    await payload.update({
      collection: 'events',
      id,
      draft: true,
      data: { title: 'Editor title' },
      user: editor,
      overrideAccess: false,
    });
    expect((await draftOf(id)).humanEditedFields).toEqual(['title']);

    const proposal = await ingest([
      event({
        externalId: 'evt-2',
        title: 'Bot title v3',
        venueName: 'New Hall',
      }),
    ]);
    expect((proposal.body.results as Json[])[0]!.outcome).toBe('updated');
    const after = await draftOf(id);
    expect(after.title).toBe('Editor title');
    expect(after.venueName).toBe('New Hall');
    expect(after.hasPendingUpdates).toBe(true);
    const pending = await payload.find({
      collection: 'pending-updates',
      where: { targetId: { equals: id } },
      overrideAccess: true,
    });
    expect(pending.docs).toHaveLength(1);
    const changes = (pending.docs[0] as unknown as Json).changes as Json[];
    expect(changes.map((change) => change.field)).toEqual(['title']);

    await payload.update({
      collection: 'pending-updates',
      id: String(pending.docs[0]!.id),
      data: { status: 'applied' },
      user: editor,
      overrideAccess: false,
    });
    const applied = await draftOf(id);
    expect(applied.title).toBe('Bot title v3');
    expect(applied.hasPendingUpdates).toBe(false);
    expect(applied.humanEditedFields).toEqual([]);
  });

  it('enforces approval before publication and role permissions server-side', async () => {
    const created = await ingest([event({ externalId: 'evt-3' })]);
    const id = String((created.body.results as Json[])[0]!.id);

    await expect(
      payload.update({
        collection: 'events',
        id,
        data: { _status: 'published' },
        user: reviewer,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/approved/iu);
    await expect(
      payload.update({
        collection: 'events',
        id,
        draft: true,
        data: { reviewStatus: 'approved' },
        user: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow();
    await expect(
      payload.update({
        collection: 'events',
        id,
        data: { reviewStatus: 'approved', _status: 'published' },
        context: { ingestion: true },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/bots cannot publish/iu);

    await payload.update({
      collection: 'events',
      id,
      data: { reviewStatus: 'approved', _status: 'published' },
      user: reviewer,
      overrideAccess: false,
    });
    const listed = await publicGet('/public/v1/events');
    expect((listed.body.data as Json[]).map((item) => item.id)).toContain(id);

    await expect(
      payload.find({ collection: 'events', overrideAccess: false }),
    ).rejects.toThrow();
    await expect(
      payload.find({
        collection: 'ingestion-clients',
        user: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow();
  });

  it('applies verified cancellations to live content immediately', async () => {
    const created = await ingest([
      event({ externalId: 'evt-4', title: 'Cancellable' }),
    ]);
    const id = String((created.body.results as Json[])[0]!.id);
    await payload.update({
      collection: 'events',
      id,
      data: { reviewStatus: 'approved', _status: 'published' },
      user: reviewer,
      overrideAccess: false,
    });
    await payload.update({
      collection: 'events',
      id,
      draft: true,
      data: { eventStatus: 'scheduled', summary: 'Edited by human' },
      user: editor,
      overrideAccess: false,
    });

    const cancelled = await ingest([
      event({
        externalId: 'evt-4',
        title: 'Cancellable',
        eventStatus: 'cancelled',
      }),
    ]);
    expect((cancelled.body.results as Json[])[0]!.outcome).toBe('updated');
    const slug = String((created.body.results as Json[])[0]!.slug);
    const detail = await publicGet('/public/v1/events/:slug', { slug });
    expect((detail.body.data as Json).status).toBe('cancelled');
    expect((detail.body.data as Json).summary).toBe('Ai meetup in Brno.');
  });

  it('flags conflicting date changes and hides them after the grace period', async () => {
    const created = await ingest([
      event({ externalId: 'evt-5', title: 'Moving event' }),
    ]);
    const id = String((created.body.results as Json[])[0]!.id);
    const slug = String((created.body.results as Json[])[0]!.slug);
    await payload.update({
      collection: 'events',
      id,
      data: { reviewStatus: 'approved', _status: 'published' },
      user: reviewer,
      overrideAccess: false,
    });

    // Date change on a published record with no human edit: corrected live at once.
    const moved = future(12);
    await ingest([
      event({
        externalId: 'evt-5',
        title: 'Moving event',
        startsAt: moved,
        endsAt: future(12, 19),
      }),
    ]);
    expect(
      ((await publicGet('/public/v1/events/:slug', { slug })).body.data as Json)
        .startsAt,
    ).toBe(moved);

    // A human edits the date; a conflicting bot date becomes a critical proposal.
    await payload.update({
      collection: 'events',
      id,
      data: {
        startsAt: future(13),
        endsAt: future(13, 19),
        _status: 'published',
      },
      user: reviewer,
      overrideAccess: false,
    });
    const conflict = await ingest([
      event({
        externalId: 'evt-5',
        title: 'Moving event',
        startsAt: future(14),
        endsAt: future(14, 19),
      }),
    ]);
    expect((conflict.body.results as Json[])[0]!.outcome).toBe('proposed');
    const pending = await payload.find({
      collection: 'pending-updates',
      where: { targetId: { equals: id } },
      overrideAccess: true,
    });
    expect((pending.docs[0] as unknown as Json).severity).toBe('critical');
    expect((await publicGet('/public/v1/events/:slug', { slug })).status).toBe(
      200,
    );

    await payload.db.updateOne({
      collection: 'events',
      id,
      data: {
        criticalUpdatePendingSince: new Date(
          Date.now() - 3 * DAY,
        ).toISOString(),
      },
      returning: false,
    });
    expect((await publicGet('/public/v1/events/:slug', { slug })).status).toBe(
      404,
    );
  });

  it('removes rejected content from the API and never resurrects it', async () => {
    const created = await ingest([
      event({ externalId: 'evt-6', title: 'To reject' }),
    ]);
    const id = String((created.body.results as Json[])[0]!.id);
    const slug = String((created.body.results as Json[])[0]!.slug);
    await payload.update({
      collection: 'events',
      id,
      data: { reviewStatus: 'approved', _status: 'published' },
      user: reviewer,
      overrideAccess: false,
    });
    expect((await publicGet('/public/v1/events/:slug', { slug })).status).toBe(
      200,
    );

    await payload.update({
      collection: 'events',
      id,
      draft: true,
      data: { reviewStatus: 'rejected' },
      user: reviewer,
      overrideAccess: false,
    });
    expect((await publicGet('/public/v1/events/:slug', { slug })).status).toBe(
      404,
    );

    const again = await ingest([
      event({ externalId: 'evt-6', title: 'To reject (updated)' }),
    ]);
    expect((again.body.results as Json[])[0]).toMatchObject({
      outcome: 'unchanged',
      reason: 'rejected_by_editor',
    });
    expect((await draftOf(id)).reviewStatus).toBe('rejected');
  });

  it('keeps archived events reachable by slug but out of listings', async () => {
    const created = await ingest([
      event({ externalId: 'evt-7', title: 'Archive me' }),
    ]);
    const id = String((created.body.results as Json[])[0]!.id);
    const slug = String((created.body.results as Json[])[0]!.slug);
    await payload.update({
      collection: 'events',
      id,
      data: { reviewStatus: 'approved', _status: 'published' },
      user: reviewer,
      overrideAccess: false,
    });
    await payload.update({
      collection: 'events',
      id,
      draft: true,
      data: { reviewStatus: 'archived' },
      user: reviewer,
      overrideAccess: false,
    });
    const listed = await publicGet('/public/v1/events');
    expect((listed.body.data as Json[]).map((item) => item.id)).not.toContain(
      id,
    );
    expect((await publicGet('/public/v1/events/:slug', { slug })).status).toBe(
      200,
    );
  });

  it('authenticates bots with scoped credentials and supports idempotent retries', async () => {
    expect(
      (
        await ingest([event()], {
          token: 'vch_0000000000000000_' + 'a'.repeat(43),
        })
      ).status,
    ).toBe(401);
    const newsOnly = await createBotToken(payload, 'news-bot', ['news']);
    expect((await ingest([event()], { token: newsOnly })).status).toBe(403);

    const key = 'retry-key-0001';
    const first = await ingest([event({ externalId: 'evt-8' })], {
      idempotencyKey: key,
    });
    const replay = await ingest([event({ externalId: 'evt-8' })], {
      idempotencyKey: key,
    });
    expect(replay.body.runId).toBe(first.body.runId);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');

    const runHandler = await findEndpoint('/ingest/v1/runs/:id');
    const run = await runHandler(
      endpointRequest(payload, {
        url: `https://cms.example.test/api/ingest/v1/runs/${String(first.body.runId)}`,
        headers: { authorization: `Bearer ${token}` },
        routeParams: { id: String(first.body.runId) },
      }),
    );
    expect(run.status).toBe(200);
    const otherBot = await runHandler(
      endpointRequest(payload, {
        url: 'https://cms.example.test/api/ingest/v1/runs/x',
        headers: { authorization: `Bearer ${newsOnly}` },
        routeParams: { id: String(first.body.runId) },
      }),
    );
    expect(otherBot.status).toBe(404);
  });

  it('lets only administrators create credentials and returns a working token once', async () => {
    const handler = await findEndpoint('/ingest/credentials', 'post');
    const request = (user: unknown) =>
      handler({
        ...endpointRequest(payload, {
          method: 'POST',
          url: 'https://cms.example.test/api/ingest/credentials',
          user,
        }),
        json: () =>
          Promise.resolve({
            name: 'News',
            botId: 'news-bot-2',
            scopes: ['events'],
          }),
      });
    expect((await request(editor)).status).toBe(403);
    expect((await request(null)).status).toBe(403);
    const admin = await createStaff(payload, 'admin');
    const created = await request(admin);
    expect(created.status).toBe(201);
    const { token: issued } = (await created.json()) as { token: string };
    const stored = await payload.find({
      collection: 'ingestion-clients',
      where: { botId: { equals: 'news-bot-2' } },
      overrideAccess: true,
    });
    expect(JSON.stringify(stored.docs)).not.toContain(issued);
    expect(
      (await ingest([event({ externalId: 'evt-cred' })], { token: issued }))
        .status,
    ).toBe(200);
  });

  it('skips items from blocked source domains', async () => {
    await payload.create({
      collection: 'sources',
      data: {
        title: 'Blocked organiser',
        url: 'https://blocked.example.net',
        sourceType: 'website',
        usageRights: 'do_not_use',
        ingestionBlocked: true,
      },
      overrideAccess: true,
    });
    const response = await ingest([
      event({
        externalId: 'evt-blocked',
        sourceUrl: 'https://www.blocked.example.net/e/1',
      }),
    ]);
    expect((response.body.results as Json[])[0]).toMatchObject({
      outcome: 'skipped',
      reason: 'source_blocked',
    });
  });

  it('rejects free-food claims without evidence', async () => {
    const response = await ingest([
      event({ externalId: 'evt-food', freeFood: 'yes' }),
    ]);
    expect(response.status).toBe(422);
    expect((response.body.results as Json[])[0]).toMatchObject({
      outcome: 'failed',
      reason: 'validation_failed',
    });
  });
});
