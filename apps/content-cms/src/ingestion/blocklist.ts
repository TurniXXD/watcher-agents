let generation = 0;

/** Bumped whenever a Source changes so ingestion reloads blocked domains. */
export const invalidateBlockedDomains = (): void => {
  generation += 1;
};

export const blockedDomainsGeneration = (): number => generation;
