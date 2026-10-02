import { z } from 'zod';
import { searchAresSubjects } from '@watcher/sources/company';
import type { Collector, EntityRef, EvidenceDocument } from './types.js';
import { fetchOfficialJson, fetchOptionalOfficialJson } from './http-json.js';

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

const corporateAddress = (
  legalForm: string | undefined,
  value: string | undefined,
): string | undefined =>
  ['112', '121'].includes(legalForm ?? '') ? value?.trim() : undefined;

export const createAresNameCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'ARES_NAME_SEARCH',
  supports: ['COMPANY_NAME', 'FULL_NAME'],
  priority: 120,
  collect: async (selector, signal) => {
    const response = await searchAresSubjects(selector.value, {
      limit: 10,
      signal,
      fetcher,
    });
    return response.subjects.map((subject) => {
      const address = corporateAddress(
        subject.pravniForma,
        subject.sidlo?.textovaAdresa,
      );
      const organization: EntityRef = {
        kind: 'ORGANIZATION',
        key: `ico:${subject.ico}`,
        label: subject.obchodniJmeno ?? `IČO ${subject.ico}`,
      };
      const exact =
        subject.obchodniJmeno?.localeCompare(selector.value, 'cs', {
          sensitivity: 'base',
        }) === 0;
      return {
        sourceKey: `ares:name-search:${selector.value.toLocaleLowerCase('cs')}:${subject.ico}`,
        sourceUrl: `https://ares.gov.cz/ekonomicke-subjekty?ico=${subject.ico}`,
        excerpt:
          `${subject.obchodniJmeno ?? subject.ico} · IČO ${subject.ico} · výsledek vyhledávání ARES podle názvu${exact ? ' (přesná textová shoda)' : ''}; samotná shoda jména nepotvrzuje totožnost osoby`.slice(
            0,
            900,
          ),
        data: {
          query: selector.value,
          totalResults: response.total,
          ico: subject.ico,
          name: subject.obchodniJmeno ?? null,
          legalForm: subject.pravniForma ?? null,
          registeredAt: subject.datumVzniku ?? null,
          exactNameMatch: exact,
          address: address ?? null,
        },
        ...(date(subject.datumAktualizace)
          ? { observedAt: date(subject.datumAktualizace) }
          : {}),
        findings: [
          { entity: organization, predicate: 'ICO', value: subject.ico },
          ...(subject.obchodniJmeno
            ? [
                {
                  entity: organization,
                  predicate: 'REGISTERED_NAME',
                  value: subject.obchodniJmeno,
                },
              ]
            : []),
          {
            entity: organization,
            predicate: 'NAME_SEARCH_QUERY',
            value: selector.value,
          },
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
        links: [],
        discoveredSelectors: [
          {
            type: 'ICO' as const,
            value: subject.ico,
            original: `ARES name result for ${selector.value}`,
            depth: selector.depth + 1,
          },
        ],
      };
    });
  },
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
    const address = corporateAddress(
      data.pravniForma,
      data.sidlo?.textovaAdresa,
    );
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

const insolvencySchema = z.object({
  icoId: z.string().optional(),
  zaznamy: z
    .array(
      z.object({
        obchodniJmeno: z.string().optional(),
        jmenoPrijmeni: z.string().optional(),
        upadek: z
          .array(
            z.object({
              spisZn: z.string().optional(),
              datum: z.string().optional(),
              detail: z.string().optional(),
              akceUpadek: z.string().optional(),
              typUpadek: z.string().optional(),
              soudUpadek: z.string().optional(),
              spravceUpadku: z
                .object({ jmenoPrijmeni: z.string().optional() })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export const createAresInsolvencyCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'ARES_INSOLVENCY_CEU',
  supports: ['ICO'],
  priority: 80,
  collect: async (selector, signal) => {
    const url = `${base}/ekonomicke-subjekty-ceu/${selector.value}`;
    const response = await fetchOptionalOfficialJson(
      url,
      insolvencySchema,
      signal,
      fetcher,
    );
    if (!response) return [];
    const organization: EntityRef = {
      kind: 'ORGANIZATION',
      key: `ico:${selector.value}`,
      label: `IČO ${selector.value}`,
    };
    return (response.zaznamy ?? []).flatMap((record, recordIndex) =>
      (record.upadek ?? []).slice(0, 20).map((proceeding, index) => {
        const reference =
          proceeding.spisZn ?? `record-${recordIndex + 1}-${index + 1}`;
        return {
          sourceKey: `ares:ceu:${selector.value}:${reference}`,
          sourceUrl: url,
          excerpt:
            `Veřejný záznam CEÚ pro IČO ${selector.value}: ${reference}${proceeding.typUpadek ? ` · ${proceeding.typUpadek}` : ''}${proceeding.akceUpadek ? ` · ${proceeding.akceUpadek}` : ''}${proceeding.datum ? ` · ${proceeding.datum}` : ''}`.slice(
              0,
              900,
            ),
          data: {
            ico: selector.value,
            name: record.obchodniJmeno ?? record.jmenoPrijmeni ?? null,
            caseReference: proceeding.spisZn ?? null,
            date: proceeding.datum ?? null,
            action: proceeding.akceUpadek ?? null,
            type: proceeding.typUpadek ?? null,
            court: proceeding.soudUpadek ?? null,
            administrator: proceeding.spravceUpadku?.jmenoPrijmeni ?? null,
            detail: proceeding.detail ?? null,
          },
          ...(date(proceeding.datum)
            ? { observedAt: date(proceeding.datum) }
            : {}),
          findings: [
            {
              entity: organization,
              predicate: 'INSOLVENCY_CASE',
              value: reference,
              ...(date(proceeding.datum)
                ? { observedAt: date(proceeding.datum) }
                : {}),
            },
          ],
          links: [],
        };
      }),
    );
  },
});
