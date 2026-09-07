import { z } from 'zod';

export const activityTypes = [
  'NEW_EVENT',
  'REGISTRATION_OPEN',
  'RECRUITMENT',
  'MEETING',
  'WORKSHOP',
  'LECTURE',
  'DEADLINE',
  'TRIP',
  'VOLUNTEER_OPPORTUNITY',
  'ANNOUNCEMENT',
  'OTHER_RELEVANT_UPDATE',
] as const;
export const activityTypeSchema = z.enum(activityTypes);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const sourceTypes = [
  'WEBSITE',
  'INSTAGRAM',
  'FACEBOOK',
  'RSS',
  'CALENDAR',
  'LINKTREE',
  'OTHER',
] as const;
export type ClubSourceType = (typeof sourceTypes)[number];
export type ClubSourceStatus =
  'ACTIVE' | 'UNSUPPORTED' | 'BROKEN' | 'MANUAL' | 'NO_MONITORABLE_SOURCE';

export type ClubSourceDefinition = {
  id: string;
  type: ClubSourceType;
  url?: string;
  username?: string;
  status: ClubSourceStatus;
};

export type ClubDefinition = {
  id: string;
  slug: string;
  name: string;
  status: ClubSourceStatus;
  discoveryUrl?: string;
  sources: ClubSourceDefinition[];
};

export type CandidateActivity = {
  sourceId: string;
  externalItemId: string;
  title: string;
  content: string;
  sourceUrl: string;
  publishedAt?: Date;
  raw?: unknown;
};

export const classifiedActivitySchema = z
  .object({
    relevant: z.boolean(),
    type: activityTypeSchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(10_000),
    importance: z.number().int().min(1).max(5),
    confidence: z.number().min(0).max(1),
    startAt: z.date().optional(),
    deadlineAt: z.date().optional(),
    location: z.string().trim().min(1).max(500).optional(),
    signupUrl: z.url().optional(),
  })
  .strict();
export type ClassifiedActivity = z.infer<typeof classifiedActivitySchema>;

export type MonitorSource = {
  id: string;
  fetch(
    source: ClubSourceDefinition,
    signal?: AbortSignal,
  ): Promise<CandidateActivity[]>;
};
