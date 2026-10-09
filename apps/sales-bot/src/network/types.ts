import { z } from 'zod';

export const networkSheetHeaders = [
  'Name',
  'Datum potkání',
  'Místo potkání',
  'Kontakt',
  'Poznámka k potkání',
  'Typ kontaktu',
  'Domluvena další schůzka',
  'Aktivní kontakt',
] as const;

export const networkContactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  metDate: z.string().trim().max(80).optional(),
  metAt: z.string().trim().max(300).optional(),
  contact: z.string().trim().max(1_000).optional(),
  meetingNote: z.string().trim().max(4_000).optional(),
  contactType: z.string().trim().max(300).optional(),
  followUp: z.string().trim().max(500).optional(),
  active: z.boolean().default(true),
});

export type NetworkContactInput = z.infer<typeof networkContactInputSchema>;

export type NetworkContact = NetworkContactInput & {
  /** Virtual identifier backed by the current Google Sheet row number. */
  id: string;
};

export type NetworkContactPatch = Partial<NetworkContactInput>;

export type NetworkMatch = {
  contact: NetworkContact;
  quality: 'excellent' | 'good' | 'possible';
  reasons: string[];
};

export interface NetworkRepository {
  getContacts(): Promise<NetworkContact[]>;
  getContactById(id: string): Promise<NetworkContact | undefined>;
  createContact(input: NetworkContactInput): Promise<NetworkContact>;
  updateContact(
    id: string,
    patch: NetworkContactPatch,
  ): Promise<NetworkContact>;
  searchContacts(query: string): Promise<NetworkContact[]>;
}

export interface NetworkSearchService {
  search(query: string, contacts: NetworkContact[]): Promise<NetworkMatch[]>;
}
