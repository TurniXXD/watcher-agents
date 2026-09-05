import type { DomainEvent, EventJournal } from './stock-domain/events.js';
import type { DatabaseClient } from './client.js';
import { prismaJson } from './json.js';

export class PostgresEventJournal implements EventJournal {
  public constructor(private readonly db: DatabaseClient) {}

  public async append(event: DomainEvent): Promise<void> {
    await this.db.domainEvent.create({
      data: {
        id: event.id,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        occurredAt: event.occurredAt,
        payload: prismaJson(event.payload),
      },
    });
  }

  public list(type?: string) {
    return this.db.domainEvent.findMany({
      where: type ? { type } : {},
      orderBy: { occurredAt: 'asc' },
    });
  }
}
