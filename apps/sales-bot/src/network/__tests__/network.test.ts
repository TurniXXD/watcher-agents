import { describe, expect, it, vi } from 'vitest';
import { findDuplicateContacts } from '../deduplication.js';
import { NetworkAiService } from '../ai.js';
import {
  GoogleSheetsNetworkRepository,
  sheetRowToContact,
} from '../google-sheets-repository.js';
import { lexicalNetworkSearch } from '../search.js';
import type { NetworkContact } from '../types.js';

const contact = (overrides: Partial<NetworkContact> = {}): NetworkContact => ({
  id: '2',
  name: 'Jan Novák',
  metDate: '2026-09-12',
  metAt: 'Startup Night Brno',
  phone: '+420 777 123 456',
  email: 'jan@example.cz',
  web: 'https://example.cz',
  socialNetwork: 'https://linkedin.com/in/jan-novak',
  meetingNote: 'Dělá B2B sales a má kontakty ve výrobních firmách.',
  contactType: 'B2B sales',
  followUp: '2026-11-15',
  active: true,
  ...overrides,
});

describe('network sheet mapping', () => {
  it('maps the exact eleven user-provided columns without extending the sheet', () => {
    expect(
      sheetRowToContact(
        [
          'Jan Novák',
          '2026-09-12',
          'Startup Night Brno',
          '+420 777 123 456',
          'jan@example.cz',
          'https://example.cz',
          'https://linkedin.com/in/jan-novak',
          'B2B sales',
          'Obchodní kontakt',
          '2026-11-15',
          'Ne',
        ],
        7,
      ),
    ).toEqual({
      id: '7',
      name: 'Jan Novák',
      metDate: '2026-09-12',
      metAt: 'Startup Night Brno',
      phone: '+420 777 123 456',
      email: 'jan@example.cz',
      web: 'https://example.cz',
      socialNetwork: 'https://linkedin.com/in/jan-novak',
      meetingNote: 'B2B sales',
      contactType: 'Obchodní kontakt',
      followUp: '2026-11-15',
      active: false,
    });
  });

  it('validates headers and appends in the same eleven-column order', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          [
            'Jméno',
            'Datum potkání',
            'Místo potkání',
            'Telefon',
            'Email',
            'Web',
            'sociální síť',
            'Poznámka k potkání',
            'Typ kontaktu',
            'Domluvena další schůzka',
            'Aktivní kontakt',
          ],
          [
            'Jan Novák',
            '',
            '',
            '+420 777 123 456',
            'jan@example.cz',
            'https://example.cz',
            'https://linkedin.com/in/jan-novak',
            '',
            '',
            '',
            'Ano',
          ],
        ],
      },
    });
    const append = vi.fn().mockResolvedValue({
      data: { updates: { updatedRange: "'Contact list'!A3:K3" } },
    });
    const repository = new GoogleSheetsNetworkRepository({
      spreadsheetId: 'sheet-id',
      range: "'Contact list'!A:K",
      serviceAccountEmail: 'service@example.test',
      serviceAccountPrivateKey: 'unused-in-test',
      sheets: {
        spreadsheets: { values: { get, append } },
      } as never,
    });

    expect(await repository.getContacts()).toHaveLength(1);
    await expect(
      repository.createContact({
        name: 'Petra Malá',
        metAt: 'Brno',
        active: true,
      }),
    ).resolves.toMatchObject({ id: '3', name: 'Petra Malá' });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          values: [
            ['Petra Malá', '', 'Brno', '', '', '', '', '', '', '', 'Ano'],
          ],
        },
      }),
    );
  });

  it('rejects a sheet whose header does not match the contract', async () => {
    const repository = new GoogleSheetsNetworkRepository({
      spreadsheetId: 'sheet-id',
      range: "'Contact list'!A:K",
      serviceAccountEmail: 'service@example.test',
      serviceAccountPrivateKey: 'unused-in-test',
      sheets: {
        spreadsheets: {
          values: {
            get: vi.fn().mockResolvedValue({
              data: { values: [['Wrong header']] },
            }),
          },
        },
      } as never,
    });
    await expect(repository.getContacts()).rejects.toThrow(
      'nemá očekávané záhlaví',
    );
  });
});

describe('network duplicate detection and search', () => {
  it('prepares a useful manual draft without Ollama', async () => {
    await expect(
      new NetworkAiService().parseContact(
        'Přidej do networku Petra Nováka, dělá účetnictví pro malé firmy.',
        '2026-10-08',
      ),
    ).resolves.toMatchObject({
      name: 'Petra Nováka',
      meetingNote:
        'Přidej do networku Petra Nováka, dělá účetnictví pro malé firmy.',
      active: true,
    });
  });

  it.each([
    ['same e-mail', { email: 'jan@example.cz' }],
    ['same phone', { phone: '+420 777 123 456' }],
    [
      'same LinkedIn profile',
      { socialNetwork: 'https://linkedin.com/in/jan-novak/' },
    ],
  ])('detects %s as a strong duplicate', (_label, fields) => {
    expect(
      findDuplicateContacts(
        { name: 'Different Person', ...fields, active: true },
        [contact()],
      ),
    ).toHaveLength(1);
  });

  it('detects a normalized name duplicate', () => {
    expect(
      findDuplicateContacts({ name: 'Jan Novak', active: true }, [contact()]),
    ).toHaveLength(1);
  });

  it('uses pragmatic semantic expansions when Ollama is unavailable', () => {
    const matches = lexicalNetworkSearch(
      'Potřebuji někoho na získávání zákazníků ve výrobě',
      [contact()],
    );
    expect(matches[0]?.contact.name).toBe('Jan Novák');
    expect(matches[0]?.reasons.join(' ')).toContain('sales');
  });
});
