import type { ClubDefinition } from './types.js';

const active = 'ACTIVE' as const;
const unsupported = 'UNSUPPORTED' as const;

export const clubRegistry: readonly ClubDefinition[] = Object.freeze([
  {
    id: 'debate-brno',
    slug: 'debatni-klub-brno',
    name: 'Debatní klub Brno',
    status: active,
    sources: [
      {
        id: 'debate-brno-website',
        type: 'WEBSITE',
        url: 'https://www.debatabrno.cz/',
        status: active,
      },
      {
        id: 'debate-brno-instagram',
        type: 'INSTAGRAM',
        username: 'debata_brno',
        url: 'https://www.instagram.com/debata_brno/',
        status: active,
      },
    ],
  },
  {
    id: 'ifmsa-brno',
    slug: 'ifmsa-brno',
    name: 'IFMSA CZ Brno',
    status: active,
    sources: [
      {
        id: 'ifmsa-brno-website',
        type: 'WEBSITE',
        url: 'https://ifmsa.cz/',
        status: active,
      },
      {
        id: 'ifmsa-brno-instagram',
        type: 'INSTAGRAM',
        username: 'ifmsa_cz_brno',
        url: 'https://www.instagram.com/ifmsa_cz_brno/',
        status: active,
      },
      {
        id: 'ifmsa-brno-facebook',
        type: 'FACEBOOK',
        url: 'https://www.facebook.com/IFMSA-CZ-Brno-180727982185',
        status: unsupported,
      },
    ],
  },
  {
    id: 'ki-brno',
    slug: 'klub-investoru-brno',
    name: 'Klub investorů Brno',
    status: active,
    sources: [
      {
        id: 'ki-brno-website',
        type: 'WEBSITE',
        url: 'https://www.klubinvestoru.com/',
        status: active,
      },
      {
        id: 'ki-brno-linktree',
        type: 'LINKTREE',
        url: 'https://linktr.ee/kibrno',
        status: active,
      },
      {
        id: 'ki-brno-instagram',
        type: 'INSTAGRAM',
        username: 'ki_brno',
        url: 'https://www.instagram.com/ki_brno/',
        status: active,
      },
    ],
  },
  {
    id: 'spolek-prirodovedcu',
    slug: 'spolek-prirodovedcu-mu',
    name: 'Spolek přírodovědců MU',
    status: active,
    sources: [
      {
        id: 'spolek-prirodovedcu-website',
        type: 'WEBSITE',
        url: 'https://spolek.sci.muni.cz/',
        status: active,
      },
      {
        id: 'spolek-prirodovedcu-instagram',
        type: 'INSTAGRAM',
        username: 'spolek_prirodovedcu',
        url: 'https://www.instagram.com/spolek_prirodovedcu/',
        status: active,
      },
      {
        id: 'spolek-prirodovedcu-facebook',
        type: 'FACEBOOK',
        url: 'https://www.facebook.com/SpolekPrirodovedcu',
        status: unsupported,
      },
    ],
  },
  {
    id: 'centrum-lidska-prava',
    slug: 'centrum-lidska-prava',
    name: 'Centrum pro lidská práva a demokracii',
    status: active,
    sources: [
      {
        id: 'centrum-lidska-prava-website',
        type: 'WEBSITE',
        url: 'https://www.centrumlidskaprava.cz/',
        status: active,
      },
    ],
  },
  {
    id: 'projekt-spolu',
    slug: 'projekt-spolu',
    name: 'Projekt SPOLU',
    status: active,
    sources: [
      {
        id: 'projekt-spolu-website',
        type: 'WEBSITE',
        url: 'https://www.projektspolu.cz/',
        status: active,
      },
      {
        id: 'projekt-spolu-linktree',
        type: 'LINKTREE',
        url: 'https://linktr.ee/projektspolu_brno',
        status: active,
      },
      {
        id: 'projekt-spolu-instagram',
        type: 'INSTAGRAM',
        username: 'projektspolu',
        url: 'https://www.instagram.com/projektspolu/',
        status: active,
      },
    ],
  },
  {
    id: 'sfl-cz',
    slug: 'students-for-liberty-cz',
    name: 'Students for Liberty CZ',
    status: active,
    sources: [
      {
        id: 'sfl-cz-website',
        type: 'WEBSITE',
        url: 'https://studentsforlibertycz.cz/',
        status: active,
      },
      {
        id: 'sfl-cz-linktree',
        type: 'LINKTREE',
        url: 'https://linktr.ee/sflcz',
        status: active,
      },
      {
        id: 'sfl-cz-instagram',
        type: 'INSTAGRAM',
        username: 'czech.sfl',
        url: 'https://www.instagram.com/czech.sfl/',
        status: active,
      },
    ],
  },
  {
    id: 'mise-nadeje',
    slug: 'mise-nadeje',
    name: 'Mise naděje',
    status: active,
    sources: [
      {
        id: 'mise-nadeje-website',
        type: 'WEBSITE',
        url: 'https://www.misenadeje.cz/',
        status: active,
      },
    ],
  },
  ...[
    'Grey CoLab',
    'Synapse FSS',
    'Mediation and Negotiation Society',
    'Klub degustační turistiky',
  ].map((name) => ({
    id: name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, ''),
    slug: name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, ''),
    name,
    status: 'NO_MONITORABLE_SOURCE' as const,
    sources: [],
  })),
]);
