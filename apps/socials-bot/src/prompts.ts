type PromptItem = {
  title: string;
  channel: string;
  format: string;
  contentPillar: string;
  targetAudience: string;
  objective: string;
  angle: string;
  hook: string | null;
  cta: string | null;
  plannedAt: Date | null;
  requiredAssets: readonly string[];
  estimatedPreparationMinutes: number;
  idea: { description: string };
  topics: readonly { topic: { name: string } }[];
  projects: readonly {
    project: {
      name: string;
      description: string | null;
      visibility: string;
      websiteUrl: string | null;
    };
  }[];
  sources: readonly {
    source: {
      title: string;
      url: string | null;
      summary: string | null;
      verificationStatus: string;
    };
  }[];
};

const formatInstructions = (item: PromptItem): string => {
  if (item.channel === 'LINKEDIN') {
    return 'Napiš profesionální LinkedIn příspěvek s konkrétním úvodem, stručným příběhem nebo argumentem, 3–5 praktickými body a přirozeným CTA.';
  }
  if (item.format === 'REEL') {
    return 'Připrav scénář na 30–60 sekund, shot list, text titulku, caption a krátký text na cover.';
  }
  if (item.format === 'CAROUSEL') {
    return 'Připrav 5–8 slidů, každý s jednou jasnou myšlenkou, a doprovodný caption.';
  }
  if (item.channel === 'BLOG') {
    return 'Připrav SEO-aware článek v MDX: title, slug, meta description, osnovu H2/H3, praktické příklady, návrhy interních odkazů a CTA.';
  }
  return 'Připrav kompletní měsíční newsletter: předmět, preview text, úvod, hlavní sekce založené na skutečné práci a jedno přirozené CTA.';
};

const verifiedSources = (item: PromptItem): string => {
  const sources = item.sources.filter(
    ({ source }) => source.verificationStatus === 'VERIFIED',
  );
  if (!sources.length)
    return '- Nejsou přiložené žádné ověřené externí zdroje. Nevymýšlej čísla ani tvrzení.';
  return sources
    .map(
      ({ source }) =>
        `- ${source.title}${source.url ? ` — ${source.url}` : ''}${source.summary ? `: ${source.summary}` : ''}`,
    )
    .join('\n');
};

export const buildChatGptPrompt = (item: PromptItem): string => {
  const publicProjects = item.projects.filter(
    ({ project }) => project.visibility === 'PUBLIC',
  );
  return `Jsi zkušený český B2B content editor. Připrav obsah pro nezávislého českého vývojáře a podnikatele z vantuch.dev.

## Zadání
- Platforma: ${item.channel}
- Formát: ${item.format}
- Cílové publikum: ${item.targetAudience}
- Business cíl: ${item.objective}
- Téma: ${item.title}
- Pilíř: ${item.contentPillar}
- Úhel: ${item.angle}
- Hook: ${item.hook ?? 'Navrhni konkrétní, ne clickbaitový hook.'}
- CTA: ${item.cta ?? 'Navrhni přirozené CTA bez nátlaku.'}

## Kontext a ověřená fakta
Původní poznámka: ${item.idea.description}
Témata: ${item.topics.map(({ topic }) => topic.name).join(', ') || 'neuvedena'}
Veřejné projekty: ${publicProjects.map(({ project }) => `${project.name}${project.description ? ` — ${project.description}` : ''}${project.websiteUrl ? ` (${project.websiteUrl})` : ''}`).join('; ') || 'žádný bezpečně zveřejnitelný projekt'}

## Zdroje
${verifiedSources(item)}

## Požadovaný výstup
${formatInstructions(item)}

## Styl
- Přirozená čeština, profesionální, přístupná a konkrétní.
- Žádný generický AI hype, motivační klišé ani přehnané sliby.
- Nevymýšlej klienty, výsledky, citace, čísla ani funkce projektu.
- Jasně označ tvrzení, která vyžadují ověření.
- Minimum emoji a hashtagů; hashtagy pouze pokud přinášejí skutečný smysl.
- Nezveřejňuj soukromé nebo důvěrné projekty.

Vrať pouze hotový návrh a krátký seznam faktů, které mám před publikací ověřit.`;
};

export const buildSundayContentPack = (input: {
  weekLabel: string;
  planId: string;
  items: readonly PromptItem[];
}): string => {
  const totalMinutes = input.items.reduce(
    (sum, item) => sum + item.estimatedPreparationMinutes,
    0,
  );
  const overview = input.items
    .map(
      (item) =>
        `- ${item.plannedAt?.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) ?? 'bez data'} — ${item.channel}/${item.format}: ${item.title}`,
    )
    .join('\n');
  const prompts = input.items
    .map(
      (item, index) =>
        `## ${index + 1}. ${item.channel} — ${item.title}\n\n${buildChatGptPrompt(item)}`,
    )
    .join('\n\n---\n\n');
  const assets = [
    ...new Set(input.items.flatMap((item) => item.requiredAssets)),
  ];
  return `# Sunday Content Pack — ${input.weekLabel}

Plan ID: ${input.planId}

## Týdenní přehled
${overview || 'Pro tento týden nejsou naplánované položky. Nebyl vytvořen žádný výplňový obsah.'}

## Cíle
- Priorita: kvalifikované B2B příležitosti a důvěryhodnost skrze skutečnou práci.
- Celkový odhad přípravy: ${totalMinutes} minut.
- Publikování zůstává ruční; naplánovaný čas není potvrzením publikace.

## Vizuální checklist
${assets.length ? assets.map((asset) => `- [ ] ${asset}`).join('\n') : '- [ ] Nejsou vyžadované zvláštní vizuály.'}

## Prompty pro ChatGPT

${prompts}
`;
};
