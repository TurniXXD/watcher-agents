import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const domainEventSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  occurredAt: z.date(),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventInput = Omit<DomainEvent, 'id' | 'occurredAt'> & {
  id?: string;
  occurredAt?: Date;
};
export type DomainEventHandler = (event: DomainEvent) => Promise<void> | void;

export interface EventJournal {
  append(event: DomainEvent): Promise<void>;
}

export interface EventBus {
  publish(event: DomainEventInput): Promise<DomainEvent>;
  subscribe(type: string, handler: DomainEventHandler): () => void;
}

export class InProcessEventBus implements EventBus {
  readonly #handlers = new Map<string, Set<DomainEventHandler>>();

  public constructor(private readonly journal?: EventJournal) {}

  public subscribe(type: string, handler: DomainEventHandler): () => void {
    const handlers = this.#handlers.get(type) ?? new Set<DomainEventHandler>();
    handlers.add(handler);
    this.#handlers.set(type, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#handlers.delete(type);
    };
  }

  public async publish(input: DomainEventInput): Promise<DomainEvent> {
    const event = domainEventSchema.parse({
      ...input,
      id: input.id ?? randomUUID(),
      occurredAt: input.occurredAt ?? new Date(),
    });
    await this.journal?.append(event);
    const handlers = [
      ...(this.#handlers.get(event.type) ?? []),
      ...(this.#handlers.get('*') ?? []),
    ];
    const results = await Promise.allSettled(
      handlers.map(async (handler) => handler(event)),
    );
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        failures.push(result.reason as unknown);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Domain event ${event.type} failed`);
    }
    return event;
  }
}
