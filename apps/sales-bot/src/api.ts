import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { z } from 'zod';
import type { SalesService } from './service.js';

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(100),
  offer: z.string().trim().min(1).max(2_000),
  subjectTemplate: z.string().trim().min(1).max(300),
  bodyTemplate: z.string().trim().min(1).max(5_000),
  discoveryFeedUrl: z.url().optional(),
  quicklyCampaignId: z.number().int().positive().optional(),
});
const evidenceSchema = z.object({
  campaignId: z.uuid(),
  email: z.email().transform((value) => value.toLowerCase()),
  basis: z.enum(['RECIPIENT_OPT_IN', 'EXISTING_CUSTOMER']),
  evidenceSource: z.string().trim().min(3).max(200),
  evidenceReference: z.string().trim().min(3).max(1_000),
  capturedAt: z.iso.datetime().transform((value) => new Date(value)),
  expiresAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .optional(),
});
const feedLeadSchema = z.object({
  campaignId: z.uuid(),
  source: z.string().trim().min(1).max(100),
  sourceExternalId: z.string().trim().min(1).max(300),
  companyName: z.string().trim().min(1).max(300),
  websiteUrl: z.url(),
  sourceUrl: z.url().optional(),
});
const webhookSchema = z.object({
  event: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  data: z
    .object({
      lead_id: z.number().int().optional(),
      lead_email: z.email().optional(),
      campaign_id: z.number().int().optional(),
    })
    .passthrough(),
});

const authorized = (request: IncomingMessage, token: string): boolean => {
  const provided =
    request.headers.authorization?.replace(/^Bearer\s+/iu, '') ?? '';
  const actual = Buffer.from(provided);
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  let text = '';
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text.length > 1_000_000) throw new Error('Request body exceeds 1 MB');
  }
  return JSON.parse(text) as unknown;
};

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

export class SalesApi {
  private server?: Server;
  public constructor(
    private readonly store: SalesStore,
    private readonly service: SalesService,
    private readonly apiToken: string,
    private readonly webhookToken: string,
    private readonly logger: WatcherLogger,
    private readonly notify: (message: string) => Promise<void>,
  ) {}

  public async start(port: number): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        this.logger.error({ err: error }, 'Sales API request failed');
        if (!response.headersSent)
          send(response, error instanceof z.ZodError ? 400 : 500, {
            error:
              error instanceof z.ZodError ? 'invalid_input' : 'request_failed',
          });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '0.0.0.0', resolve);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (method === 'GET' && path === '/healthz') {
      send(response, 200, { status: 'ok' });
      return;
    }
    const isWebhook = path === '/v1/webhooks/quickly';
    if (!authorized(request, isWebhook ? this.webhookToken : this.apiToken)) {
      send(response, 401, { error: 'unauthorized' });
      return;
    }
    if (isWebhook && method === 'POST') {
      const payload = webhookSchema.parse(await readBody(request));
      const id = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      if (await this.store.hasWebhook(id)) {
        send(response, 200, { duplicate: true });
        return;
      }
      const leadById = payload.data.lead_id
        ? await this.store.findLeadByQuicklyId(payload.data.lead_id)
        : null;
      const lead =
        leadById ??
        (payload.data.lead_email && payload.data.campaign_id
          ? await this.store.findLeadByQuicklyCampaignEmail(
              payload.data.campaign_id,
              payload.data.lead_email.toLowerCase(),
            )
          : payload.event !== 'email.sent' && payload.data.lead_email
            ? await this.store.findLeadByEmail(
                payload.data.lead_email.toLowerCase(),
              )
            : null);
      if (payload.event === 'email.sent' && !lead)
        this.logger.warn(
          {
            quicklyLeadId: payload.data.lead_id,
            quicklyCampaignId: payload.data.campaign_id,
          },
          'Quickly sent email could not be matched to a sales lead',
        );
      if (
        ['email.bounced', 'lead.unsubscribed', 'lead.not_interested'].includes(
          payload.event,
        ) &&
        payload.data.lead_email
      )
        await this.store.suppress(
          `email:${payload.data.lead_email.toLowerCase()}`,
          payload.event,
        );
      if (lead) {
        const stages: Record<
          string,
          | 'CONTACTED'
          | 'REPLIED'
          | 'INTERESTED'
          | 'NOT_INTERESTED'
          | 'BOUNCED'
          | 'UNSUBSCRIBED'
        > = {
          'email.sent': 'CONTACTED',
          'lead.replied': 'REPLIED',
          'lead.interested': 'INTERESTED',
          'lead.not_interested': 'NOT_INTERESTED',
          'email.bounced': 'BOUNCED',
          'lead.unsubscribed': 'UNSUBSCRIBED',
        };
        const stage = stages[payload.event];
        if (stage) await this.store.setLeadStage(lead.id, stage);
        if (
          ['BOUNCED', 'UNSUBSCRIBED', 'NOT_INTERESTED'].includes(stage ?? '') &&
          lead.email
        )
          await this.store.suppress(
            `email:${lead.email.toLowerCase()}`,
            payload.event,
          );
      }
      try {
        await this.store.recordWebhook(
          id,
          payload.event,
          payload,
          new Date(payload.timestamp),
          lead?.id,
        );
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          send(response, 200, { duplicate: true });
          return;
        }
        throw error;
      }
      if (lead && ['lead.replied', 'lead.interested'].includes(payload.event))
        await this.notify(
          `Sales lead ${lead.companyName} (${lead.id}) replied: ${payload.event}`,
        );
      send(response, 200, { accepted: true });
      return;
    }
    if (method === 'POST' && path === '/v1/campaigns') {
      const input = campaignSchema.parse(await readBody(request));
      send(
        response,
        201,
        await this.store.createCampaign({
          name: input.name,
          offer: input.offer,
          subjectTemplate: input.subjectTemplate,
          bodyTemplate: input.bodyTemplate,
          ...(input.discoveryFeedUrl
            ? { discoveryFeedUrl: input.discoveryFeedUrl }
            : {}),
          ...(input.quicklyCampaignId
            ? { quicklyCampaignId: input.quicklyCampaignId }
            : {}),
        }),
      );
      return;
    }
    if (method === 'GET' && path === '/v1/campaigns') {
      send(response, 200, await this.store.listCampaigns());
      return;
    }
    const campaignMatch = path.match(/^\/v1\/campaigns\/([0-9a-f-]+)$/iu);
    if (method === 'PATCH' && campaignMatch) {
      const data = z
        .object({
          enabled: z.boolean().optional(),
          pausedReason: z.string().max(300).nullable().optional(),
          quicklyCampaignId: z.number().int().positive().nullable().optional(),
          discoveryFeedUrl: z.url().nullable().optional(),
        })
        .strict()
        .parse(await readBody(request));
      send(
        response,
        200,
        await this.store.updateCampaign(campaignMatch[1]!, {
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.pausedReason !== undefined
            ? { pausedReason: data.pausedReason }
            : {}),
          ...(data.quicklyCampaignId !== undefined
            ? { quicklyCampaignId: data.quicklyCampaignId }
            : {}),
          ...(data.discoveryFeedUrl !== undefined
            ? { discoveryFeedUrl: data.discoveryFeedUrl }
            : {}),
        }),
      );
      return;
    }
    if (method === 'POST' && path === '/v1/leads') {
      const lead = feedLeadSchema.parse(await readBody(request));
      if (!(await this.store.getCampaign(lead.campaignId))) {
        send(response, 404, { error: 'campaign_not_found' });
        return;
      }
      send(
        response,
        202,
        await this.store.discoverLead({
          campaignId: lead.campaignId,
          source: lead.source,
          sourceExternalId: lead.sourceExternalId,
          companyName: lead.companyName,
          websiteUrl: lead.websiteUrl,
          ...(lead.sourceUrl ? { sourceUrl: lead.sourceUrl } : {}),
        }),
      );
      return;
    }
    if (method === 'GET' && path === '/v1/leads') {
      send(response, 200, await this.store.listLeads());
      return;
    }
    const leadMatch = path.match(/^\/v1\/leads\/([0-9a-f-]+)$/iu);
    if (method === 'GET' && leadMatch) {
      const lead = await this.store.getLead(leadMatch[1]!);
      if (!lead) {
        send(response, 404, { error: 'lead_not_found' });
        return;
      }
      send(response, 200, {
        lead,
        eligibility: await this.service.eligibility(lead.id),
      });
      return;
    }
    if (method === 'POST' && path === '/v1/evidence') {
      const input = evidenceSchema.parse(await readBody(request));
      if (!(await this.store.getCampaign(input.campaignId))) {
        send(response, 404, { error: 'campaign_not_found' });
        return;
      }
      if (
        input.capturedAt > new Date() ||
        (input.expiresAt && input.expiresAt <= input.capturedAt)
      ) {
        send(response, 400, { error: 'invalid_evidence_dates' });
        return;
      }
      send(
        response,
        201,
        await this.store.recordAuthorization({
          campaignId: input.campaignId,
          email: input.email,
          basis: input.basis,
          evidenceSource: input.evidenceSource,
          evidenceReference: input.evidenceReference,
          capturedAt: input.capturedAt,
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        }),
      );
      return;
    }
    const evidenceEventsMatch = path.match(
      /^\/v1\/campaigns\/([0-9a-f-]+)\/evidence\/(.+)\/events$/u,
    );
    if (method === 'GET' && evidenceEventsMatch) {
      send(
        response,
        200,
        await this.store.listAuthorizationEvents(
          evidenceEventsMatch[1]!,
          decodeURIComponent(evidenceEventsMatch[2]!).toLowerCase(),
        ),
      );
      return;
    }
    const evidenceMatch = path.match(
      /^\/v1\/campaigns\/([0-9a-f-]+)\/evidence\/(.+)$/u,
    );
    if (method === 'GET' && evidenceMatch) {
      send(
        response,
        200,
        await this.store.getAuthorization(
          evidenceMatch[1]!,
          decodeURIComponent(evidenceMatch[2]!).toLowerCase(),
        ),
      );
      return;
    }
    if (method === 'DELETE' && evidenceMatch) {
      send(
        response,
        200,
        await this.store.revokeAuthorization(
          evidenceMatch[1]!,
          decodeURIComponent(evidenceMatch[2]!).toLowerCase(),
        ),
      );
      return;
    }
    const decisionMatch = path.match(
      /^\/v1\/leads\/([0-9a-f-]+)\/(approve|reject)$/iu,
    );
    if (method === 'POST' && decisionMatch) {
      const data = z
        .object({ actor: z.string().min(1).max(200) })
        .parse(await readBody(request));
      send(
        response,
        200,
        await this.store.decideLead(
          decisionMatch[1]!,
          decisionMatch[2] === 'approve',
          'API',
          data.actor,
        ),
      );
      return;
    }
    if (method === 'POST' && path === '/v1/suppressions') {
      const data = z
        .object({ email: z.email(), reason: z.string().min(1).max(200) })
        .parse(await readBody(request));
      send(
        response,
        201,
        await this.store.suppress(
          `email:${data.email.toLowerCase()}`,
          data.reason,
        ),
      );
      return;
    }
    if (method === 'POST' && path === '/v1/run') {
      send(response, 200, await this.service.run());
      return;
    }
    send(response, 404, { error: 'not_found' });
  }
}
