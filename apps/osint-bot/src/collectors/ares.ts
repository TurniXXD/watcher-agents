import { z } from 'zod';
import type { Collector, EntityRef, EvidenceDocument } from './types.js';
import { fetchOfficialJson } from './http-json.js';

const base = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';
const date = (value: string | undefined): Date | undefined =>
  value && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : undefined;
const subjectSchema = z.object({
  ico: z.string(),
  obchodniJmeno: z.string().optional(),
  pravniForma: z.string().optional(),
  datumVzniku: z.string().optional(),
  datumAktualizace: z.string().optional(),
  sidlo: z.object({ textovaAdresa: z.string().optional() }).optional(),
});

export const createAresCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'ARES',
  supports: ['ICO'],
  priority: 100,
  collect: async (selector, signal) => {
    const url = `${base}/ekonomicke-subjekty/${selector.value}`;
    const data = await fetchOfficialJson(url, subjectSchema, signal, fetcher);
    if (data.ico !== selector.value)
      throw new Error('ARES returned a different IČO');
    const organization: EntityRef = {
      kind: 'ORGANIZATION',
      key: `ico:${data.ico}`,
      label: data.obchodniJmeno ?? data.ico,
    };
    // Registered seats of sole traders may be private homes. Only retain
    // addresses for legal forms verified as corporate entities in the CZSO codebook.
    const address = ['112', '121'].includes(data.pravniForma ?? '')
      ? data.sidlo?.textovaAdresa?.trim()
      : undefined;
    const result: EvidenceDocument = {
      sourceKey: `ares:subject:${data.ico}`,
      sourceUrl: url,
      excerpt: `${data.obchodniJmeno ?? data.ico} · IČO ${data.ico}${address ? ` · sídlo ${address}` : ''}`,
      data: {
        ico: data.ico,
        name: data.obchodniJmeno ?? null,
        legalForm: data.pravniForma ?? null,
        registeredAt: data.datumVzniku ?? null,
        address: address ?? null,
      },
      ...(date(data.datumAktualizace)
        ? { observedAt: date(data.datumAktualizace) }
        : {}),
      findings: [
        { entity: organization, predicate: 'ICO', value: data.ico },
        ...(data.obchodniJmeno
          ? [
              {
                entity: organization,
                predicate: 'REGISTERED_NAME',
                value: data.obchodniJmeno,
              },
            ]
          : []),
        ...(data.pravniForma
          ? [
              {
                entity: organization,
                predicate: 'LEGAL_FORM_CODE',
                value: data.pravniForma,
              },
            ]
          : []),
        ...(data.datumVzniku
          ? [
              {
                entity: organization,
                predicate: 'REGISTERED_AT',
                value: data.datumVzniku,
                observedAt: date(data.datumVzniku),
              },
            ]
          : []),
        ...(address
          ? [
              {
                entity: organization,
                predicate: 'REGISTERED_ADDRESS',
                value: address,
              },
            ]
          : []),
      ],
      links: address
        ? [
            {
              from: organization,
              to: {
                kind: 'ADDRESS',
                key: `address:${address.toLowerCase()}`,
                label: address,
              },
              type: 'REGISTERED_AT_ADDRESS',
            },
          ]
        : [],
    };
    return [result];
  },
});

const memberSchema = z.object({
  datumZapisu: z.string().optional(),
  datumVymazu: z.string().optional(),
  nazevAngazma: z.string().optional(),
  clenstvi: z
    .object({
      funkce: z
        .object({
          nazev: z.string().optional(),
          zanikFunkce: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  fyzickaOsoba: z
    .object({ jmeno: z.string().optional(), prijmeni: z.string().optional() })
    .optional(),
});
const registerSchema = z.object({
  zaznamy: z
    .array(
      z.object({
        datumVymazu: z.string().optional(),
        statutarniOrgany: z
          .array(
            z.object({
              datumVymazu: z.string().optional(),
              clenoveOrganu: z.array(memberSchema).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export const createAresRegisterCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'ARES_PUBLIC_REGISTER',
  supports: ['ICO'],
  priority: 90,
  collect: async (selector, signal) => {
    const url = `${base}/ekonomicke-subjekty-vr/${selector.value}`;
    const response = await fetchOfficialJson(
      url,
      registerSchema,
      signal,
      fetcher,
    );
    const organization: EntityRef = {
      kind: 'ORGANIZATION',
      key: `ico:${selector.value}`,
      label: `IČO ${selector.value}`,
    };
    const members =
      response.zaznamy
        ?.filter((record) => !record.datumVymazu)
        .flatMap(
          (record) =>
            record.statutarniOrgany
              ?.filter((body) => !body.datumVymazu)
              .flatMap((body) => body.clenoveOrganu ?? []) ?? [],
        ) ?? [];
    const active = members
      .filter(
        (member) =>
          !member.datumVymazu &&
          !member.clenstvi?.funkce?.zanikFunkce &&
          member.fyzickaOsoba?.jmeno &&
          member.fyzickaOsoba.prijmeni,
      )
      .slice(0, 25);
    // ARES exposes private addresses and birth dates. Parse and persist neither.
    const individual: EvidenceDocument[] = active.map((member) => {
      const name =
        `${member.fyzickaOsoba?.jmeno ?? ''} ${member.fyzickaOsoba?.prijmeni ?? ''}`.trim();
      const role =
        member.clenstvi?.funkce?.nazev ??
        member.nazevAngazma ??
        'člen statutárního orgánu';
      const person: EntityRef = {
        kind: 'PERSON',
        key: `ares-role:${selector.value}:${name.toLocaleLowerCase('cs')}:${role.toLocaleLowerCase('cs')}:${member.datumZapisu ?? 'unknown'}`,
        label: name,
      };
      return {
        sourceKey: `ares:register:${person.key}`,
        sourceUrl: url,
        excerpt: `${name} · ${role} · ${selector.value} (aktuální záznam ARES)`,
        data: {
          ico: selector.value,
          name,
          role,
          validFrom: member.datumZapisu ?? null,
        },
        findings: [
          { entity: person, predicate: 'PUBLIC_NAME', value: name },
          ...(member.datumZapisu
            ? [
                {
                  entity: person,
                  predicate: 'ROLE_SINCE',
                  value: member.datumZapisu,
                  observedAt: date(member.datumZapisu),
                },
              ]
            : []),
        ],
        links: [
          {
            from: person,
            to: organization,
            type: 'STATUTORY_ROLE',
            ...(date(member.datumZapisu)
              ? { validFrom: date(member.datumZapisu) }
              : {}),
          },
        ],
      };
    });
    const roster = active
      .map((member) =>
        `${member.fyzickaOsoba?.jmeno ?? ''} ${member.fyzickaOsoba?.prijmeni ?? ''}: ${member.clenstvi?.funkce?.nazev ?? member.nazevAngazma ?? 'člen'}`.trim(),
      )
      .sort()
      .join('; ');
    return [
      {
        sourceKey: `ares:register:roster:${selector.value}`,
        sourceUrl: url,
        excerpt:
          `Aktuální statutární záznamy pro IČO ${selector.value}: ${roster || 'žádné uvedené'}`.slice(
            0,
            900,
          ),
        data: { ico: selector.value, activeRoster: roster },
        findings: [
          {
            entity: organization,
            predicate: 'CURRENT_STATUTORY_ROSTER',
            value: roster || '(žádný záznam)',
          },
        ],
        links: [],
      },
      ...individual,
    ];
  },
});
