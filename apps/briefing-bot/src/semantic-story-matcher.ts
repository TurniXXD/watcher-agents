import { createHash } from 'node:crypto';
import type { BriefingEvent, WatcherLogger } from '@watcher/core';
import type {
  BriefingEmbeddingState,
  BriefingSemanticPair,
  BriefingStoryClusterStore,
} from '@watcher/database';
import {
  semanticPairKey,
  semanticRelationshipSupported,
} from './story-clustering.js';

type EmbeddingProvider = {
  embed(input: readonly string[], signal?: AbortSignal): Promise<number[][]>;
};

type EmbeddingStore = Pick<
  BriefingStoryClusterStore,
  'listEmbeddingStates' | 'saveEmbedding' | 'findSemanticPairs'
>;

const BATCH_SIZE = 32;

const embeddingText = (event: BriefingEvent): string =>
  [
    event.title,
    event.summary,
    ...event.entities.map((entity) =>
      [entity.type, entity.name, entity.ticker, entity.id]
        .filter(Boolean)
        .join(' '),
    ),
  ]
    .join('\n')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();

const contentHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export class SemanticStoryMatcher {
  public constructor(
    private readonly model: string,
    private readonly embeddings: EmbeddingProvider,
    private readonly store: EmbeddingStore,
    private readonly logger?: WatcherLogger,
    private readonly minimumSimilarity = 0.82,
    private readonly windowHours = 96,
  ) {}

  public async matchingPairs(
    events: readonly BriefingEvent[],
  ): Promise<ReadonlySet<string>> {
    if (events.length < 2) return new Set();
    const documents = events.map((event) => ({
      event,
      text: embeddingText(event),
      hash: contentHash(embeddingText(event)),
    }));
    const states = new Map(
      (await this.store.listEmbeddingStates(events.map(({ id }) => id))).map(
        (state: BriefingEmbeddingState) => [state.eventId, state],
      ),
    );
    const missing = documents.filter(({ event, hash }) => {
      const state = states.get(event.id);
      return state?.model !== this.model || state.inputHash !== hash;
    });
    if (missing.length > 0) {
      for (let start = 0; start < missing.length; start += BATCH_SIZE) {
        const batch = missing.slice(start, start + BATCH_SIZE);
        const vectors = await this.embeddings.embed(
          batch.map(({ text }) => text),
        );
        await Promise.all(
          batch.map(({ event, hash }, index) =>
            this.store.saveEmbedding({
              eventId: event.id,
              model: this.model,
              inputHash: hash,
              embedding: vectors[index],
            }),
          ),
        );
      }
    }
    const candidates = await this.store.findSemanticPairs({
      eventIds: events.map(({ id }) => id),
      model: this.model,
      minimumSimilarity: this.minimumSimilarity,
      windowHours: this.windowHours,
    });
    const byId = new Map(events.map((event) => [event.id, event]));
    const accepted = new Set<string>();
    for (const candidate of candidates) {
      const left = byId.get(candidate.leftEventId);
      const right = byId.get(candidate.rightEventId);
      if (!left || !right || !semanticRelationshipSupported(left, right)) {
        continue;
      }
      accepted.add(semanticPairKey(left.id, right.id));
    }
    this.logger?.info(
      {
        embeddingModel: this.model,
        eventCount: events.length,
        generatedEmbeddingCount: missing.length,
        semanticCandidateCount: candidates.length,
        semanticMatchCount: accepted.size,
      },
      'Briefing semantic story matching completed',
    );
    return accepted;
  }
}

export type { BriefingSemanticPair };
