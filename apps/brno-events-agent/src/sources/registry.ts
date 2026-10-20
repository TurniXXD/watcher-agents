import type { EventSource } from '../domain/types.js';
import { CeitecEventSource } from './ceitec.js';
import { HtmlEventSource, PaginatedHtmlEventSource } from './html-source.js';
import {
  IcalEventSource,
  impactHubCalendarFeed,
  nextcloudPublicCalendarFeed,
} from './ical.js';
import { parseMeetupHtml } from './meetup.js';
import {
  parseCsobValidationCampHtml,
  parseGoOutHtml,
  parseObjevBrnoHtml,
  parseJicHtml,
  parseMuniHtml,
  parseSideQuestyHtml,
  parseVisitBrnoHtml,
  parseVelvetInnovationHtml,
  parseVutHtml,
} from './site-html.js';

export type SourceSettings = Record<
  string,
  { interval: number; enabled: boolean; url?: string }
>;
const config = (
  settings: SourceSettings,
  id: string,
  defaultUrl: string,
): { url: string; interval: number; enabled: boolean } => ({
  ...settings[id]!,
  url: settings[id]?.url ?? defaultUrl,
});

export const createSources = (settings: SourceSettings): EventSource[] => {
  const meetup = config(
    settings,
    'meetup',
    'https://www.meetup.com/find/cz--brno/',
  );
  const goout = config(
    settings,
    'goout',
    'https://goout.net/en/brno/events/lezjyvlkkzqo/',
  );
  const visitBrno = config(
    settings,
    'visitbrno',
    'https://www.gotobrno.cz/en/events-in-brno/',
  );
  const muni = config(
    settings,
    'muni',
    'https://www.muni.cz/en/events-calendar',
  );
  const vut = config(settings, 'vut', 'https://www.vut.cz/en/but/events');
  const jic = config(settings, 'jic', 'https://www.jic.cz/cz/akce');
  const ceitec = config(settings, 'ceitec', 'https://www.ceitec.eu/events/');
  const velvetInnovation = config(
    settings,
    'velvet-innovation',
    'https://www.velvetinnovation.com/cs/meetupy',
  );
  const sidequesty = config(
    settings,
    'sidequesty',
    'https://www.sidequesty.com/events/',
  );
  const objevBrno = config(
    settings,
    'objev-brno',
    'https://www.objevbrno.cz/cs/akce-zdarma',
  );
  const impactHub = config(
    settings,
    'impact-hub-brno',
    'https://impacthub.cz/brno',
  );
  const base48 = config(
    settings,
    'base48-calendar',
    'https://nextcloud.at.base48.cz/apps/calendar/embed/oM82tg3RJDLDyZbz/dayGridMonth/now',
  );
  const csobValidationCamps = config(
    settings,
    'csob-validation-camps',
    'https://www.csob.cz/csob/spolecenska-odpovednost/filantropie/grantovy-kalendar',
  );
  return [
    new HtmlEventSource(
      'meetup',
      'Meetup Brno',
      meetup.url,
      meetup.interval,
      meetup.enabled,
      ['networking'],
      [parseMeetupHtml],
    ),
    new HtmlEventSource(
      'goout',
      'GoOut Brno',
      goout.url,
      goout.interval,
      goout.enabled,
      ['culture'],
      [parseGoOutHtml],
    ),
    new PaginatedHtmlEventSource(
      'visitbrno',
      'VisitBrno / TIC Brno',
      visitBrno.url,
      visitBrno.interval,
      visitBrno.enabled,
      ['culture'],
      parseVisitBrnoHtml,
      '#more-actions-grid[href]',
    ),
    new PaginatedHtmlEventSource(
      'muni',
      'Masaryk University',
      muni.url,
      muni.interval,
      muni.enabled,
      ['university', 'lecture'],
      parseMuniHtml,
      'link[rel="next"][href], a.paging__pages__next[href]',
    ),
    new HtmlEventSource(
      'vut',
      'Brno University of Technology',
      vut.url,
      vut.interval,
      vut.enabled,
      ['university', 'engineering'],
      [parseVutHtml],
    ),
    new HtmlEventSource(
      'jic',
      'JIC',
      jic.url,
      jic.interval,
      jic.enabled,
      ['startup', 'entrepreneurship'],
      [parseJicHtml],
    ),
    new CeitecEventSource(
      'ceitec',
      'CEITEC',
      ceitec.url,
      ceitec.interval,
      ceitec.enabled,
      ['science', 'biology', 'biotech'],
    ),
    new HtmlEventSource(
      'velvet-innovation',
      'Velvet Innovation Meetups',
      velvetInnovation.url,
      velvetInnovation.interval,
      velvetInnovation.enabled,
      ['networking', 'startup', 'business'],
      [parseVelvetInnovationHtml],
    ),
    new HtmlEventSource(
      'sidequesty',
      'SideQuesty',
      sidequesty.url,
      sidequesty.interval,
      sidequesty.enabled,
      ['social', 'networking', 'outdoors'],
      [parseSideQuestyHtml],
    ),
    new HtmlEventSource(
      'objev-brno',
      'Objev Brno — akce zdarma',
      objevBrno.url,
      objevBrno.interval,
      objevBrno.enabled,
      ['culture'],
      [parseObjevBrnoHtml],
    ),
    new IcalEventSource(
      'impact-hub-brno',
      'Impact Hub Brno',
      impactHub.url,
      impactHub.interval,
      impactHub.enabled,
      impactHubCalendarFeed(impactHub.url),
      {
        categories: ['networking', 'business'],
        filter: (event) =>
          /(?:^|\W)brno(?:\W|$)/iu.test(
            `${event.venue?.name ?? ''} ${event.venue?.address ?? ''} ${event.description ?? ''}`,
          ),
      },
    ),
    new IcalEventSource(
      'base48-calendar',
      'Base48 public calendar',
      base48.url,
      base48.interval,
      base48.enabled,
      nextcloudPublicCalendarFeed(base48.url),
      {
        categories: ['maker', 'networking'],
        filter: (event) =>
          /base ?48|brno/iu.test(
            `${event.title} ${event.venue?.name ?? ''} ${event.description ?? ''}`,
          ),
      },
    ),
    new HtmlEventSource(
      'csob-validation-camps',
      'ČSOB Start it @UNI Validation Camps',
      csobValidationCamps.url,
      csobValidationCamps.interval,
      csobValidationCamps.enabled,
      ['startup', 'entrepreneurship', 'networking', 'workshop'],
      [parseCsobValidationCampHtml],
    ),
  ];
};
