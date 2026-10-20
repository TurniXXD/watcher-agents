export type NetworkingEventSourceDefinition = {
  id: string;
  name: string;
  url: string;
  mode: 'OPERATIONAL' | 'AGGREGATED' | 'MANUAL_ONLY';
  notes: string;
};

export const networkingEventSources: readonly NetworkingEventSourceDefinition[] =
  [
    {
      id: 'brno-events',
      name: 'Watcher Brno Events',
      url: 'internal://brno-events-agent',
      mode: 'OPERATIONAL',
      notes:
        'Normalizovaný společný katalog; výpadek jednoho zdroje nezastaví ostatní.',
    },
    {
      id: 'velvet-innovation',
      name: 'Velvet Innovation Meetups',
      url: 'https://www.velvetinnovation.com/cs/meetupy',
      mode: 'AGGREGATED',
      notes:
        'Automaticky načítá Brno Events agent z veřejného přehledu meetupů.',
    },
    {
      id: 'sidequesty',
      name: 'SideQuesty',
      url: 'https://www.sidequesty.com/events/',
      mode: 'AGGREGATED',
      notes:
        'Automaticky načítá Brno Events agent a zachovává pouze budoucí akce.',
    },
    {
      id: 'objev-brno',
      name: 'Objev Brno — akce zdarma',
      url: 'https://www.objevbrno.cz/cs/akce-zdarma',
      mode: 'AGGREGATED',
      notes:
        'Automaticky načítá Brno Events agent; bezplatný vstup je doložen zaměřením katalogu.',
    },
    {
      id: 'impact-hub-brno',
      name: 'Impact Hub Brno',
      url: 'https://impacthub.cz/brno',
      mode: 'AGGREGATED',
      notes:
        'Automaticky načítá veřejný kalendář a ponechává pouze akce spojené s Brnem.',
    },
    {
      id: 'base48-calendar',
      name: 'Base48 public calendar',
      url: 'https://nextcloud.at.base48.cz/apps/calendar/embed/oM82tg3RJDLDyZbz/dayGridMonth/now',
      mode: 'AGGREGATED',
      notes:
        'Automaticky načítá veřejný Nextcloud kalendář Base48 včetně opakovaných akcí.',
    },
    {
      id: 'csob-validation-camps',
      name: 'ČSOB Start it @UNI Validation Camps',
      url: 'https://www.csob.cz/csob/spolecenska-odpovednost/filantropie/grantovy-kalendar',
      mode: 'AGGREGATED',
      notes:
        'Automaticky sleduje oficiální kalendář ČSOB a importuje pouze zveřejněné brněnské termíny.',
    },
    ...[
      ['meetup-brno', 'Meetup Brno', 'https://www.meetup.com/find/cz--brno/'],
      ['jic', 'JIC', 'https://www.jic.cz/cz/akce'],
      [
        'goout-brno',
        'GoOut Brno',
        'https://goout.net/en/brno/events/lezjyvlkkzqo/',
      ],
      [
        'visitbrno',
        'VisitBrno / TIC Brno',
        'https://www.gotobrno.cz/en/events-in-brno/',
      ],
      [
        'muni',
        'Masarykova univerzita',
        'https://www.muni.cz/en/events-calendar',
      ],
      ['vut', 'VUT', 'https://www.vut.cz/en/but/events'],
      ['ceitec', 'CEITEC', 'https://www.ceitec.eu/events/'],
    ].map(([id, name, url]) => ({
      id: id!,
      name: name!,
      url: url!,
      mode: 'AGGREGATED' as const,
      notes: 'Automaticky zpracovává Brno Events agent.',
    })),
  ];
