import { z } from 'zod';
import type { HtmlParser } from './html-source.js';
import {
  absoluteUrl,
  dateValue,
  embeddedJson,
  eventCandidate,
  htmlDocument,
  walkObjects,
} from './utils.js';

const meetupEventSchema = z.object({
  __typename: z.literal('Event').optional(),
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  eventUrl: z.string(),
  dateTime: z.string(),
  endTime: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  venue: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
    })
    .nullable()
    .optional(),
  group: z.object({ name: z.string().optional() }).optional(),
  featuredEventPhoto: z
    .object({ highResUrl: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

export const parseMeetupHtml: HtmlParser = (
  html,
  pageUrl,
  _now,
  categories,
) => {
  const $ = htmlDocument(html);
  return embeddedJson($, 'script#__NEXT_DATA__[type="application/json"]')
    .flatMap(walkObjects)
    .flatMap((value) => {
      const parsed = meetupEventSchema.safeParse(value);
      if (!parsed.success) return [];
      const event = parsed.data;
      const candidate = eventCandidate({
        externalId: String(event.id),
        title: event.title,
        description: event.description ?? undefined,
        startAt: dateValue(event.dateTime),
        endAt: dateValue(event.endTime),
        eventUrl: absoluteUrl(event.eventUrl, pageUrl),
        venue: event.venue
          ? {
              name: event.venue.name,
              address: [event.venue.address, event.venue.city]
                .filter(Boolean)
                .join(', '),
            }
          : undefined,
        organizer: { name: event.group?.name },
        imageUrl: absoluteUrl(
          event.featuredEventPhoto?.highResUrl ?? undefined,
          pageUrl,
        ),
        categories,
        raw: value,
      });
      return candidate ? [candidate] : [];
    });
};
