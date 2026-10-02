import type { Selector, SelectorType } from '../selectors.js';

export type EntityRef = {
  kind:
    | 'ORGANIZATION'
    | 'PERSON'
    | 'ADDRESS'
    | 'DOMAIN'
    | 'IP_ADDRESS'
    | 'DOCUMENT'
    | 'PUBLIC_PROFILE'
    | 'CRYPTO_ADDRESS'
    | 'CADASTRAL_PARCEL'
    | 'BUILDING'
    | 'CADASTRAL_AREA';
  key: string;
  label: string;
};
export type Finding = {
  entity: EntityRef;
  predicate: string;
  value: string;
  observedAt?: Date | undefined;
};
export type Link = {
  from: EntityRef;
  to: EntityRef;
  type: string;
  validFrom?: Date | undefined;
  validTo?: Date | undefined;
};
export type EvidenceDocument = {
  sourceKey: string;
  sourceUrl: string;
  excerpt: string;
  data: Record<string, string | number | boolean | null>;
  observedAt?: Date | undefined;
  findings: Finding[];
  links: Link[];
  /**
   * Identifiers discovered by this document. The service may persist and
   * collect them in the next bounded depth wave. A name-search result remains
   * a candidate and must not be presented as a confirmed identity.
   */
  discoveredSelectors?: Selector[] | undefined;
};
export type Collector = {
  id: string;
  supports: readonly SelectorType[];
  priority: number;
  collect: (
    selector: Selector,
    signal: AbortSignal,
  ) => Promise<EvidenceDocument[]>;
};

export const selectCollectors = (
  selectors: readonly Selector[],
  collectors: readonly Collector[],
  limit: number,
): { selector: Selector; collector: Collector }[] =>
  selectors
    .flatMap((selector) =>
      collectors
        .filter((collector) => collector.supports.includes(selector.type))
        .map((collector) => ({ selector, collector })),
    )
    .sort((a, b) => b.collector.priority - a.collector.priority)
    .slice(0, limit);
