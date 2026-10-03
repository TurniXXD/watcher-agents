import { TwentyRestClient } from './client.js';
import { findCompany, upsertCompany } from './companies.js';
import {
  createFollowUpTask,
  recordInteraction,
  saveDraftNote,
} from './interactions.js';
import { createOpportunity } from './opportunities.js';
import { findPerson, upsertPerson } from './people.js';
import { createReferral } from './referrals.js';
import { createRelationship } from './relationships.js';

export * from './types.js';

export class TwentyIntegration {
  private readonly client: TwentyRestClient;

  public constructor(
    baseUrl: string,
    apiKey: string,
    private readonly useAppFields: boolean,
    fetcher?: typeof fetch,
  ) {
    this.client = new TwentyRestClient(baseUrl, apiKey, fetcher);
  }

  public findCompany = (input: Parameters<typeof findCompany>[1]) =>
    findCompany(this.client, input, this.useAppFields);
  public upsertCompany = (input: Parameters<typeof upsertCompany>[1]) =>
    upsertCompany(this.client, input, this.useAppFields);
  public findPerson = (input: Parameters<typeof findPerson>[1]) =>
    findPerson(this.client, input, this.useAppFields);
  public upsertPerson = (input: Parameters<typeof upsertPerson>[1]) =>
    upsertPerson(this.client, input, this.useAppFields);
  public createOpportunity = (input: Parameters<typeof createOpportunity>[1]) =>
    createOpportunity(this.client, input, this.useAppFields);
  public createRelationship = (
    input: Parameters<typeof createRelationship>[1],
  ) => createRelationship(this.client, input);
  public createReferral = (input: Parameters<typeof createReferral>[1]) =>
    createReferral(this.client, input);
  public saveDraftNote = (input: Parameters<typeof saveDraftNote>[1]) =>
    saveDraftNote(this.client, input);
  public recordInteraction = (input: Parameters<typeof recordInteraction>[1]) =>
    recordInteraction(this.client, input);
  public createFollowUpTask = (
    input: Parameters<typeof createFollowUpTask>[1],
  ) => createFollowUpTask(this.client, input);
}
