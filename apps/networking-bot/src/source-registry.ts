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
