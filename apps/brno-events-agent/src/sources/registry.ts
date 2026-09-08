import type { EventSource } from '../domain/types.js';
import { JsonLdEventSource } from './json-ld.js';

export type SourceSettings = Record<
  string,
  { interval: number; enabled: boolean; url?: string }
>;
const definitions = [
  [
    'meetup',
    'Meetup Brno',
    'https://www.meetup.com/find/cz--brno/',
    ['networking'],
  ],
  [
    'goout',
    'GoOut Brno',
    'https://goout.net/en/brno/events/lezjyvlkkzqo/',
    ['culture'],
  ],
  [
    'visitbrno',
    'VisitBrno / TIC Brno',
    'https://www.gotobrno.cz/en/events/',
    ['culture'],
  ],
  [
    'muni',
    'Masaryk University',
    'https://www.muni.cz/en/events-calendar',
    ['university', 'lecture'],
  ],
  [
    'vut',
    'Brno University of Technology',
    'https://www.vut.cz/en/but/events/kalendar-akci-f71225',
    ['university', 'engineering'],
  ],
  ['jic', 'JIC', 'https://www.jic.cz/cz/akce', ['startup', 'entrepreneurship']],
  [
    'ceitec',
    'CEITEC',
    'https://www.ceitec.eu/events/',
    ['science', 'biology', 'biotech'],
  ],
] as const;

export const createSources = (settings: SourceSettings): EventSource[] =>
  definitions.map(([id, name, defaultUrl, categories]) => {
    const config = settings[id]!;
    return new JsonLdEventSource(
      id,
      name,
      config.url ?? defaultUrl,
      config.interval,
      config.enabled,
      [...categories],
    );
  });
