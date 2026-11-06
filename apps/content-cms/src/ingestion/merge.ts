import { lexicalToText } from '../lib/lexical';
import { sameValue } from '../lib/equality';
import type { ReviewStatus } from '../fields/editorial';

export type MergeInput = {
  incoming: Record<string, unknown>;
  /** Previous bot snapshot of the managed fields. */
  snapshot: Record<string, unknown>;
  /** Current editorial values (latest draft). */
  editorial: Record<string, unknown>;
  reviewStatus: ReviewStatus;
  livePublished: boolean;
  richTextFields?: readonly string[];
  /** Fields whose staleness on live content is materially harmful. */
  criticalFields?: readonly string[];
};

export type MergePlan =
  | { kind: 'unchanged' }
  | {
      kind: 'changed';
      changedFields: string[];
      /** Applied to the editorial draft immediately. */
      autoApply: Record<string, unknown>;
      /** Also applied to the live published row (safety corrections). */
      liveCorrections: Record<string, unknown>;
      /** Left for an editor to accept or dismiss. */
      proposals: Record<string, { current: unknown; proposed: unknown }>;
      /** A conflicting critical change exists; starts the grace-period clock. */
      critical: boolean;
      /** Safety corrections applied although a human had edited the field. */
      overrides: string[];
    };

const UNREVIEWED: ReviewStatus[] = ['ingested', 'needs_review'];
const CANCELLATION_STATES = new Set(['cancelled', 'postponed']);

export const comparable = (
  field: string,
  value: unknown,
  richTextFields: readonly string[] = [],
): unknown => (richTextFields.includes(field) ? lexicalToText(value) : value);

/**
 * Decides how a bot change reaches an existing record:
 *
 * - Fields unchanged since the last snapshot are ignored, so repeated identical
 *   submissions write nothing and create no versions.
 * - A field whose editorial value differs from the previous snapshot was edited
 *   by a human and is never overwritten; the change becomes a proposal.
 * - Unreviewed, unpublished records follow the bot automatically.
 * - Reviewed or published records receive proposals, except for the safety
 *   policy: a verified cancellation/postponement is always applied, and
 *   date/status corrections are applied when no human edited those fields. A
 *   critical change that conflicts with human edits is flagged so the record
 *   leaves public listings if it is not resolved within the grace period.
 * - Rejected records only refresh their snapshot; they are never resurrected.
 */
export const planMerge = (input: MergeInput): MergePlan => {
  const rich = input.richTextFields ?? [];
  const criticalFields = input.criticalFields ?? [];
  const changedFields = Object.keys(input.incoming).filter(
    (field) =>
      !sameValue(
        comparable(field, input.incoming[field], rich),
        comparable(field, input.snapshot[field], rich),
      ),
  );
  if (changedFields.length === 0) return { kind: 'unchanged' };

  const plan = {
    kind: 'changed' as const,
    changedFields,
    autoApply: {} as Record<string, unknown>,
    liveCorrections: {} as Record<string, unknown>,
    proposals: {} as Record<string, { current: unknown; proposed: unknown }>,
    critical: false,
    overrides: [] as string[],
  };
  if (input.reviewStatus === 'rejected') return plan;

  const editable =
    !input.livePublished && UNREVIEWED.includes(input.reviewStatus);
  for (const field of changedFields) {
    const proposed = input.incoming[field];
    const humanEdited = !sameValue(
      comparable(field, input.editorial[field], rich),
      comparable(field, input.snapshot[field], rich),
    );
    if (editable && !humanEdited) {
      plan.autoApply[field] = proposed;
      continue;
    }
    if (criticalFields.includes(field)) {
      const cancellation =
        field === 'eventStatus' && CANCELLATION_STATES.has(String(proposed));
      if (cancellation || !humanEdited) {
        plan.autoApply[field] = proposed;
        if (input.livePublished) plan.liveCorrections[field] = proposed;
        if (humanEdited) plan.overrides.push(field);
        continue;
      }
      plan.critical = true;
    }
    plan.proposals[field] = { current: input.editorial[field], proposed };
  }
  return plan;
};
