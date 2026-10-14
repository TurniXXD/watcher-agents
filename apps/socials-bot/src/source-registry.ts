export type SocialEventSourceDefinition = {
  id: string;
  name: string;
  url: string;
  mode: 'OPERATIONAL' | 'AGGREGATED' | 'MANUAL_ONLY';
  notes: string;
};

export const socialEventSources: readonly SocialEventSourceDefinition[] = [
  {
    id: 'brno-events',
    name: 'Watcher Brno Events',
    url: 'internal://brno-events-agent',
    mode: 'OPERATIONAL',
    notes:
      'Normalizovaná data z existujícího agenta; zdroje se izolují a výpadek jednoho neruší ostatní.',
  },
  {
    id: 'jic',
    name: 'JIC',
    url: 'https://www.jic.cz/cz/akce',
    mode: 'AGGREGATED',
    notes: 'Automaticky zpracovává Brno Events agent.',
  },
  {
    id: 'meetup-brno',
    name: 'Meetup Brno',
    url: 'https://www.meetup.com/find/cz--brno/',
    mode: 'AGGREGATED',
    notes:
      'Veřejná stránka je zpracována existujícím Brno Events adaptérem; kapacita ani registrace se nepředpokládá.',
  },
  {
    id: 'goout-brno',
    name: 'GoOut Brno',
    url: 'https://goout.net/en/brno/events/lezjyvlkkzqo/',
    mode: 'AGGREGATED',
    notes: 'Automaticky zpracovává Brno Events agent.',
  },
  {
    id: 'muni',
    name: 'Masarykova univerzita',
    url: 'https://www.muni.cz/en/events-calendar',
    mode: 'AGGREGATED',
    notes: 'Automaticky zpracovává Brno Events agent.',
  },
  {
    id: 'vut',
    name: 'VUT',
    url: 'https://www.vut.cz/en/but/events',
    mode: 'AGGREGATED',
    notes: 'Automaticky zpracovává Brno Events agent.',
  },
  ...[
    ['msic', 'MSIC', 'https://www.ms-ic.cz/'],
    [
      'velvet-innovation',
      'Velvet Innovation',
      'https://www.velvetinnovation.com/cs/meetupy',
    ],
    ['impact-hub', 'Impact Hub', 'https://impacthub.cz/kalendar/'],
    ['czechinvest', 'CzechInvest', 'https://czechinvest.gov.cz/'],
    ['dotoho', 'DoToho!', 'https://dotoho.pro/akce/'],
    ['startupjobs', 'StartupJobs', 'https://www.startupjobs.cz/'],
    [
      'smart-network',
      'Smart Network',
      'https://www.smart-network.cz/kalendar-akci',
    ],
    [
      'meetup-ostrava',
      'Meetup Ostrava',
      'https://www.meetup.com/find/cz--ostrava/',
    ],
    ['eventbrite', 'Eventbrite', 'https://www.eventbrite.com/'],
    ['luma', 'Luma', 'https://lu.ma/'],
    ['asb', 'ASB Portal', 'https://www.asb-portal.cz/kalendar-akci'],
    [
      'techmeetup-ostrava',
      'TechMeetup Ostrava',
      'https://www.meetup.com/techmeetupostrava/',
    ],
    ['gdg', 'Google Developer Groups', 'https://gdg.community.dev/'],
    ['czechitas', 'Czechitas', 'https://www.czechitas.cz/'],
    ['github', 'GitHub community events', 'https://github.com/'],
    ['vsb', 'VŠB-TUO', 'https://www.vsb.cz/'],
  ].map(([id, name, url]) => ({
    id: id!,
    name: name!,
    url: url!,
    mode: 'MANUAL_ONLY' as const,
    notes:
      'Registr obsahuje bezpečný odkaz pro ruční objevování; automatická integrace není bez podporovaného feedu nebo API deklarována.',
  })),
];
