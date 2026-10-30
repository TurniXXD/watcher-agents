import { z } from 'zod';

const openLibraryBookSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  author_name: z.array(z.string().min(1)).optional().default([]),
  subject: z.array(z.string().min(1)).optional().default([]),
  number_of_pages_median: z.number().int().positive().optional(),
  first_publish_year: z.number().int().min(1_000).max(3_000).optional(),
});

const openLibrarySearchSchema = z.object({
  docs: z.array(openLibraryBookSchema),
});

export const bookCategories = [
  'Reality',
  'Zábava',
  'Business',
  'Psychologie',
  'Design',
  'Filozofie',
  'Politika',
  'Biologie',
  'Neurologie',
  'Chemie',
  'Bioinformatika',
  'Matematika',
  'Machine Learning',
  'Fyzika',
  'Psychedelika',
  'Historie',
  'Sci-fi',
] as const;

export const bookGenres = [
  'Beletrie',
  'Naučná',
  'Učebnice',
  'Reference',
  'Grafický memoár',
  'Duchovní',
] as const;

export const bookComplexities = [
  'Lehká',
  'Střední',
  'Náročná',
  'Neurčeno',
] as const;

export const bookDraftSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().max(2_000),
  categories: z.array(z.enum(bookCategories)).max(bookCategories.length),
  genre: z.enum(bookGenres),
  pages: z.number().int().positive().nullable(),
  complexity: z.enum(bookComplexities),
  note: z.string().max(2_000),
  sourceUrl: z.url(),
  priority: z.boolean(),
  read: z.boolean(),
  nextToRead: z.boolean(),
  favorite: z.boolean(),
});

export type BookDraft = z.infer<typeof bookDraftSchema>;

const normalized = (value: string): string =>
  value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

const categoryRules: ReadonlyArray<{
  category: (typeof bookCategories)[number];
  terms: readonly string[];
}> = [
  { category: 'Reality', terms: ['real estate', 'property law'] },
  {
    category: 'Business',
    terms: ['business', 'management', 'marketing', 'sales', 'economics'],
  },
  {
    category: 'Psychologie',
    terms: ['psychology', 'psychoanalysis', 'behavior', 'mental health'],
  },
  { category: 'Design', terms: ['design', 'architecture', 'visual arts'] },
  {
    category: 'Filozofie',
    terms: ['philosophy', 'ethics', 'metaphysics', 'existentialism'],
  },
  {
    category: 'Politika',
    terms: ['politics', 'political science', 'government', 'propaganda'],
  },
  {
    category: 'Biologie',
    terms: [
      'biology',
      'genetics',
      'evolution',
      'ecology',
      'botany',
      'mycology',
    ],
  },
  {
    category: 'Neurologie',
    terms: ['neuroscience', 'neurology', 'brain', 'neurobiology'],
  },
  {
    category: 'Chemie',
    terms: ['chemistry', 'pharmacology', 'biochemistry', 'food science'],
  },
  {
    category: 'Bioinformatika',
    terms: ['bioinformatics', 'computational biology', 'genomics'],
  },
  {
    category: 'Matematika',
    terms: ['mathematics', 'statistics', 'cryptography', 'combinatorics'],
  },
  {
    category: 'Machine Learning',
    terms: ['machine learning', 'artificial intelligence', 'neural network'],
  },
  {
    category: 'Fyzika',
    terms: ['physics', 'quantum', 'thermodynamics', 'relativity'],
  },
  {
    category: 'Psychedelika',
    terms: ['psychedelic', 'hallucinogen', 'lsd', 'entheogen'],
  },
  { category: 'Historie', terms: ['history', 'historical'] },
  {
    category: 'Sci-fi',
    terms: ['science fiction', 'dystopia', 'dystopian fiction'],
  },
];

const inferCategories = (
  title: string,
  subjects: readonly string[],
): BookDraft['categories'] => {
  const haystack = normalized([title, ...subjects].join(' '));
  const categories = categoryRules
    .filter(({ terms }) => terms.some((term) => haystack.includes(term)))
    .map(({ category }) => category);
  if (categories.length) return [...new Set(categories)];
  return subjects.some((subject) => normalized(subject).includes('fiction'))
    ? ['Zábava']
    : [];
};

const inferGenre = (subjects: readonly string[]): BookDraft['genre'] => {
  const haystack = normalized(subjects.join(' '));
  if (
    ['graphic novel', 'comic', 'graphic memoir'].some((term) =>
      haystack.includes(term),
    )
  )
    return 'Grafický memoár';
  if (
    ['textbook', 'study guide', 'problems exercises'].some((term) =>
      haystack.includes(term),
    )
  )
    return 'Učebnice';
  if (
    ['reference', 'handbook', 'encyclopedia'].some((term) =>
      haystack.includes(term),
    )
  )
    return 'Reference';
  if (
    ['spirituality', 'spiritual life', 'upanishad'].some((term) =>
      haystack.includes(term),
    )
  )
    return 'Duchovní';
  if (haystack.includes('fiction')) return 'Beletrie';
  return 'Naučná';
};

export class OpenLibraryBookClient {
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://openlibrary.org',
  ) {}

  public async find(title: string, signal?: AbortSignal): Promise<BookDraft> {
    const query = title.trim();
    if (!query) throw new Error('Book title is required.');
    const url = new URL('/search.json', this.baseUrl);
    url.searchParams.set('title', query);
    url.searchParams.set(
      'fields',
      'key,title,author_name,subject,number_of_pages_median,first_publish_year',
    );
    url.searchParams.set('limit', '5');
    const response = await this.fetcher(url, {
      headers: { 'User-Agent': 'Watcher Study Bot book metadata lookup' },
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Open Library returned HTTP ${response.status}.`);
    }
    const result = openLibrarySearchSchema.parse(await response.json());
    const exact = result.docs.find(
      (candidate) => normalized(candidate.title) === normalized(query),
    );
    const candidate = exact ?? result.docs[0];
    if (!candidate) throw new Error(`No book metadata found for “${query}”.`);
    const sourcePath = candidate.key.startsWith('/')
      ? candidate.key
      : `/works/${candidate.key}`;
    const sourceUrl = new URL(sourcePath, this.baseUrl).toString();
    const note = [
      candidate.first_publish_year
        ? `První vydání: ${candidate.first_publish_year}.`
        : undefined,
      `Metadata: Open Library (${sourceUrl}).`,
    ]
      .filter(Boolean)
      .join(' ');
    return bookDraftSchema.parse({
      title: candidate.title,
      author: candidate.author_name.join(', '),
      categories: inferCategories(candidate.title, candidate.subject),
      genre: inferGenre(candidate.subject),
      pages: candidate.number_of_pages_median ?? null,
      complexity: 'Neurčeno',
      note,
      sourceUrl,
      priority: false,
      read: false,
      nextToRead: false,
      favorite: false,
    });
  }
}
