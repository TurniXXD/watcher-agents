import type { RawEvent } from '../domain/types.js';

export type BrnoEventMessageType =
  | 'event.discovered'
  | 'event.updated'
  | 'event.cancelled'
  | 'event.high_relevance';

export type BrnoEventPublisher = {
  publish(
    type: BrnoEventMessageType,
    event: RawEvent,
    sourceId: string,
  ): Promise<void>;
};

export const noOpEventPublisher: BrnoEventPublisher = {
  publish: () => Promise.resolve(),
};
