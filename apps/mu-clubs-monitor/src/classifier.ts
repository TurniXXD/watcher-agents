import { createHash } from 'node:crypto';
import { parseCzechDate } from './date-parser.js';
import {
  classifiedActivitySchema,
  type ActivityType,
  type CandidateActivity,
  type ClassifiedActivity,
} from './types.js';

const rules: Array<[ActivityType, RegExp]> = [
  ['REGISTRATION_OPEN', /registrac|přihl[aá]š|prihl[aá]š|signup|vstupenk/iu],
  [
    'RECRUITMENT',
    /n[aá]bor|přidej se|pridej se|hled[aá]me (?:člen|dobrovol|posil)/iu,
  ],
  ['VOLUNTEER_OPPORTUNITY', /dobrovol|pom[aá]hat|zapoj se/iu],
  ['WORKSHOP', /workshop|školen|skolen|tr[eé]nink/iu],
  ['LECTURE', /předn[aá]šk|predn[aá]šk|lecture|diskus|debatu/iu],
  ['MEETING', /sch[uů]zk|setk[aá]n|meetup|sraz/iu],
  ['TRIP', /v[yý]let|exkur|trip|v[ií]kendov/iu],
  ['DEADLINE', /deadline|uz[aá]v[eě]rk|nejpozd[eě]ji|přihl[aá]šky do/iu],
  ['NEW_EVENT', /akce|ud[aá]lost|event|konferenc|turnaj|pubquiz/iu],
  ['ANNOUNCEMENT', /oznam|novink|aktualit/iu],
];

const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const firstSentence = (value: string): string =>
  clean(value)
    .split(/(?<=[.!?])\s+/u)[0]!
    .slice(0, 500);
const urlFrom = (value: string): string | undefined =>
  value.match(/https?:\/\/[^\s<>)\]]+/u)?.[0]?.replace(/[.,;!?]+$/u, '');

export const activityContentHash = (
  clubId: string,
  candidate: CandidateActivity,
): string =>
  createHash('sha256')
    .update(`${clubId}\0${clean(candidate.title)}\0${clean(candidate.content)}`)
    .digest('hex');

export class HeuristicActivityClassifier {
  public classify(
    candidate: CandidateActivity,
    now = new Date(),
  ): ClassifiedActivity {
    const combined = `${candidate.title}\n${candidate.content}`;
    const matched = rules.find(([, pattern]) => pattern.test(combined));
    const type = matched?.[0] ?? 'OTHER_RELEVANT_UPDATE';
    const date = parseCzechDate(combined, now);
    const deadlineMatch = combined.match(
      /(?:přihl[aá]šky do|deadline|uz[aá]v[eě]rka)\s+([^\n]{1,80})/iu,
    );
    const deadlineAt = deadlineMatch
      ? parseCzechDate(deadlineMatch[1]!, now)
      : undefined;
    const signupUrl = urlFrom(combined);
    const important = [
      'REGISTRATION_OPEN',
      'RECRUITMENT',
      'DEADLINE',
      'VOLUNTEER_OPPORTUNITY',
    ].includes(type);
    return classifiedActivitySchema.parse({
      relevant: Boolean(matched),
      type,
      title: firstSentence(candidate.title || candidate.content),
      summary: clean(candidate.content).slice(0, 10_000),
      importance: important ? 5 : date ? 4 : 3,
      confidence: matched ? 0.75 : 0.35,
      ...(date ? { startAt: date } : {}),
      ...(deadlineAt ? { deadlineAt } : {}),
      ...(signupUrl ? { signupUrl } : {}),
    });
  }
}
