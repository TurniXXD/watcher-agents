import type { NetworkContact, NetworkMatch } from './types.js';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/gu, ' ')
    .trim();

const expansions: Record<string, string[]> = {
  zakazniku: [
    'sales',
    'prodej',
    'obchod',
    'lead generation',
    'business development',
  ],
  prodej: ['sales', 'obchod', 'business development'],
  ucetnictvi: ['accounting', 'bookkeeping', 'tax', 'dane'],
  marketing: ['growth', 'performance', 'lead generation', 'brand'],
  reality: ['nemovitosti', 'real estate', 'property'],
  nemovitosti: ['reality', 'real estate', 'property'],
  vyvojar: ['developer', 'programator', 'software'],
};

const contactText = (contact: NetworkContact): string =>
  normalize(
    [
      contact.name,
      contact.metAt,
      contact.contact,
      contact.meetingNote,
      contact.contactType,
      contact.followUp,
    ]
      .filter(Boolean)
      .join(' '),
  );

export const lexicalNetworkSearch = (
  query: string,
  contacts: NetworkContact[],
  limit = 5,
): NetworkMatch[] => {
  const normalizedQuery = normalize(query);
  const queryTerms = new Set(
    normalizedQuery.split(' ').filter((term) => term.length > 2),
  );
  for (const term of [...queryTerms]) {
    for (const expansion of expansions[term] ?? [])
      queryTerms.add(normalize(expansion));
  }
  return contacts
    .map((contact) => {
      const text = contactText(contact);
      const matched = [...queryTerms].filter((term) => text.includes(term));
      const exactName = text.includes(normalizedQuery);
      const score =
        matched.length * 2 + (exactName ? 4 : 0) + (contact.active ? 1 : 0);
      return { contact, matched, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ contact, matched, score }) => ({
      contact,
      quality: score >= 7 ? 'excellent' : score >= 4 ? 'good' : 'possible',
      reasons: matched.slice(0, 3).map((term) => `shoda s „${term}“`),
    }));
};
