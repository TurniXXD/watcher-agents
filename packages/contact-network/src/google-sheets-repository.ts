import { google, type sheets_v4 } from 'googleapis';
import {
  networkContactInputSchema,
  networkSheetHeaders,
  type NetworkContact,
  type NetworkContactInput,
  type NetworkContactPatch,
  type NetworkRepository,
} from './types.js';

type GoogleSheetsRepositoryOptions = {
  spreadsheetId: string;
  range: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  sheets?: sheets_v4.Sheets;
};

const optionalCell = (value: unknown): string | undefined => {
  const text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value).trim()
        : '';
  return text || undefined;
};

const activeCell = (value: unknown): boolean => {
  const normalized = optionalCell(value)?.toLocaleLowerCase('cs') ?? '';
  if (['ne', 'no', 'false', '0', 'inactive', 'neaktivní'].includes(normalized))
    return false;
  return true;
};

export const sheetRowToContact = (
  row: unknown[],
  rowNumber: number,
): NetworkContact | undefined => {
  const name = optionalCell(row[0]);
  if (!name) return undefined;
  const contact = networkContactInputSchema.parse({
    name,
    ...(optionalCell(row[1]) ? { metDate: optionalCell(row[1]) } : {}),
    ...(optionalCell(row[2]) ? { metAt: optionalCell(row[2]) } : {}),
    ...(optionalCell(row[3]) ? { phone: optionalCell(row[3]) } : {}),
    ...(optionalCell(row[4]) ? { email: optionalCell(row[4]) } : {}),
    ...(optionalCell(row[5]) ? { web: optionalCell(row[5]) } : {}),
    ...(optionalCell(row[6]) ? { socialNetwork: optionalCell(row[6]) } : {}),
    ...(optionalCell(row[7]) ? { meetingNote: optionalCell(row[7]) } : {}),
    ...(optionalCell(row[8]) ? { contactType: optionalCell(row[8]) } : {}),
    ...(optionalCell(row[9]) ? { followUp: optionalCell(row[9]) } : {}),
    active: activeCell(row[10]),
  });
  return { ...contact, id: String(rowNumber) };
};

const contactToSheetRow = (contact: NetworkContactInput): string[] => [
  contact.name,
  contact.metDate ?? '',
  contact.metAt ?? '',
  contact.phone ?? '',
  contact.email ?? '',
  contact.web ?? '',
  contact.socialNetwork ?? '',
  contact.meetingNote ?? '',
  contact.contactType ?? '',
  contact.followUp ?? '',
  contact.active ? 'Ano' : 'Ne',
];

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('cs')
    .replace(/\s+/gu, ' ')
    .trim();

const parseRowId = (id: string): number => {
  const rowNumber = Number(id);
  if (!Number.isInteger(rowNumber) || rowNumber < 2)
    throw new Error(
      'Neplatné ID kontaktu. Obnovte detail kontaktu a zkuste to znovu.',
    );
  return rowNumber;
};

export class GoogleSheetsNetworkRepository implements NetworkRepository {
  readonly #spreadsheetId: string;
  readonly #range: string;
  readonly #sheetName: string;
  readonly #sheets: sheets_v4.Sheets;

  public constructor(options: GoogleSheetsRepositoryOptions) {
    this.#spreadsheetId = options.spreadsheetId;
    this.#range = options.range;
    this.#sheetName = options.range.split('!')[0] || 'Network';
    const auth = new google.auth.JWT({
      email: options.serviceAccountEmail,
      key: options.serviceAccountPrivateKey.replace(/\\+n/gu, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.#sheets = options.sheets ?? google.sheets({ version: 'v4', auth });
  }

  public async getContacts(): Promise<NetworkContact[]> {
    const response = await this.#sheets.spreadsheets.values.get({
      spreadsheetId: this.#spreadsheetId,
      range: this.#range,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = response.data.values ?? [];
    const header = rows[0] ?? [];
    const mismatch = networkSheetHeaders.find(
      (expected, index) => optionalCell(header[index]) !== expected,
    );
    if (mismatch) {
      throw new Error(
        `List ${this.#sheetName} nemá očekávané záhlaví. Očekávám přesně: ${networkSheetHeaders.join(' | ')}`,
      );
    }
    return rows
      .slice(1)
      .map((row, index) => sheetRowToContact(row, index + 2))
      .filter((contact): contact is NetworkContact => contact !== undefined);
  }

  public async getContactById(id: string): Promise<NetworkContact | undefined> {
    const rowNumber = parseRowId(id);
    const response = await this.#sheets.spreadsheets.values.get({
      spreadsheetId: this.#spreadsheetId,
      range: `${this.#sheetName}!A${rowNumber}:K${rowNumber}`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const row = response.data.values?.[0];
    const contact = row ? sheetRowToContact(row, rowNumber) : undefined;
    return contact ? { ...contact, id } : undefined;
  }

  public async createContact(
    input: NetworkContactInput,
  ): Promise<NetworkContact> {
    const contact = networkContactInputSchema.parse(input);
    const response = await this.#sheets.spreadsheets.values.append({
      spreadsheetId: this.#spreadsheetId,
      range: this.#range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [contactToSheetRow(contact)] },
    });
    const updatedRange = response.data.updates?.updatedRange ?? '';
    const rowMatch = /![A-Z]+(\d+):/u.exec(updatedRange);
    const id = rowMatch?.[1] ?? String((await this.getContacts()).length + 2);
    return { ...contact, id };
  }

  public async updateContact(
    id: string,
    patch: NetworkContactPatch,
  ): Promise<NetworkContact> {
    const rowNumber = parseRowId(id);
    const existing = await this.getContactById(id);
    if (!existing) throw new Error('Kontakt už v tabulce neexistuje.');
    const updated = networkContactInputSchema.parse({ ...existing, ...patch });
    await this.#sheets.spreadsheets.values.update({
      spreadsheetId: this.#spreadsheetId,
      range: `${this.#sheetName}!A${rowNumber}:K${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [contactToSheetRow(updated)] },
    });
    return { ...updated, id };
  }

  public async searchContacts(query: string): Promise<NetworkContact[]> {
    const terms = normalize(query).split(' ').filter(Boolean);
    if (terms.length === 0) return [];
    return (await this.getContacts()).filter((contact) => {
      const haystack = normalize(
        [
          contact.name,
          contact.metAt,
          contact.phone,
          contact.email,
          contact.web,
          contact.socialNetwork,
          contact.meetingNote,
          contact.contactType,
          contact.followUp,
        ]
          .filter(Boolean)
          .join(' '),
      );
      return terms.every((term) => haystack.includes(term));
    });
  }
}
