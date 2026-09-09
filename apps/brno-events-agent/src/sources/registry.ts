import type { EventSource } from '../domain/types.js';
import { CeitecEventSource } from './ceitec.js';
import { HtmlEventSource, PaginatedHtmlEventSource } from './html-source.js';
import { parseMeetupHtml } from './meetup.js';
import {
  parseGoOutHtml,
  parseJicHtml,
  parseMuniHtml,
  parseVisitBrnoHtml,
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
  ];
};
