import type { EventCategory, RawEvent } from '../domain/types.js';
import { normalizeText } from '../domain/normalization.js';

const weights: Partial<Record<EventCategory, number>> = {
  biology: 35,
  medicine: 30,
  biotech: 38,
  science: 28,
  ai: 35,
  programming: 30,
  software: 28,
  hardware: 28,
  iot: 30,
  maker: 32,
  engineering: 25,
  startup: 28,
  entrepreneurship: 25,
  investing: 25,
  university: 18,
  student: 15,
  lecture: 15,
  workshop: 16,
  hackathon: 25,
  networking: 12,
  conference: 14,
  culture: 8,
  film: 8,
  art: 8,
};
const keywords: Array<[RegExp, number, string]> = [
  [
    /crispr|genom|genetik|biotech|biomed|mykolog|fung|biology|biologi/iu,
    35,
    'biology/biomedicine interest',
  ],
  [
    /artificial intelligence|machine learning|\bai\b|llm|program|software|iot|hardware|3d print|maker/iu,
    30,
    'technology interest',
  ],
  [
    /startup|founder|entrepreneur|invest|venture|innovation|inovac/iu,
    25,
    'startup/investing interest',
  ],
  [
    /lecture|přednáš|seminar|workshop|hackathon|conference|konferenc/iu,
    12,
    'substantive format',
  ],
];

export const scoreEvent = (
  event: RawEvent,
  now = new Date(),
): { score: number; reasons: string[] } => {
  const text = normalizeText(
    `${event.title} ${event.description ?? ''} ${event.organizer?.name ?? ''}`,
  );
  const reasons: string[] = [];
  let score = 15;
  for (const category of event.categories) {
    const weight = weights[category] ?? 0;
    if (weight > 0) {
      score += weight;
      reasons.push(`${category} category`);
    }
  }
  for (const [pattern, points, reason] of keywords)
    if (pattern.test(text)) {
      score += points;
      reasons.push(reason);
    }
  const days = (event.startAt.getTime() - now.getTime()) / 86_400_000;
  if (days >= 0 && days <= 14) {
    score += 8;
    reasons.push('happening within 14 days');
  }
  if (event.recurring) {
    score -= 18;
    reasons.push('recurring-event penalty');
  }
  if (
    /kids only|children only|děti|party|club night|sale|výprodej/iu.test(text)
  ) {
    score -= 25;
    reasons.push('low-priority event pattern');
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: [...new Set(reasons)],
  };
};
