import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { splitTelegramMessage } from '@watcher/telegram';
import type { BusinessCardParser } from './business-card-parser.js';
import { findDuplicateContacts } from './deduplication.js';
import { lexicalNetworkSearch } from './search.js';
import type { NetworkAiService } from './ai.js';
import type {
  NetworkContact,
  NetworkContactInput,
  NetworkMatch,
  NetworkRepository,
} from './types.js';

export type NetworkBotDependencies = {
  repository: NetworkRepository;
  ai: NetworkAiService;
  cardParser?: BusinessCardParser;
  telegramToken: string;
};

type PendingContact = {
  draft: NetworkContactInput;
  duplicates: NetworkContact[];
  source: 'manual' | 'business_card';
};

const qualityLabel: Record<NetworkMatch['quality'], string> = {
  excellent: 'Silná shoda',
  good: 'Dobrá shoda',
  possible: 'Možná shoda',
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .trim();

const send = async (ctx: Context, message: string): Promise<void> => {
  for (const part of splitTelegramMessage(message, 3900)) await ctx.reply(part);
};

const formatContact = (
  contact: NetworkContactInput & { id?: string },
): string =>
  [
    `${contact.name}${contact.id ? ` (ID ${contact.id})` : ''}`,
    `Datum potkání: ${contact.metDate ?? 'neuvedeno'}`,
    `Místo potkání: ${contact.metAt ?? 'neuvedeno'}`,
    `Kontakt: ${contact.contact ?? 'neuveden'}`,
    `Typ kontaktu: ${contact.contactType ?? 'neuveden'}`,
    `Další schůzka: ${contact.followUp ?? 'neuvedena'}`,
    `Aktivní kontakt: ${contact.active ? 'Ano' : 'Ne'}`,
    `Poznámka: ${contact.meetingNote ?? 'neuvedena'}`,
  ].join('\n');

const formatMatches = (matches: NetworkMatch[]): string =>
  matches.length === 0
    ? 'V networku jsem nenašel relevantní kontakt.'
    : matches
        .map(
          ({ contact, quality, reasons }, index) =>
            `${index + 1}. ${contact.name} — ${qualityLabel[quality]}\nProč: ${reasons.join('; ')}\nTyp: ${contact.contactType ?? 'neuveden'}\nKontext: ${contact.meetingNote ?? contact.metAt ?? 'neuveden'}\nDetail: /network_contact ${contact.id}`,
        )
        .join('\n\n');

const today = (): string => new Date().toISOString().slice(0, 10);

const findOne = async (
  repository: NetworkRepository,
  reference: string,
): Promise<NetworkContact | undefined> => {
  if (/^\d+$/u.test(reference)) return repository.getContactById(reference);
  const wanted = normalize(reference);
  const contacts = await repository.getContacts();
  return (
    contacts.find((contact) => normalize(contact.name) === wanted) ??
    contacts.find((contact) => normalize(contact.name).includes(wanted))
  );
};

const parseContext = (
  value: string,
): Partial<NetworkContactInput> | undefined => {
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length < 1 || parts.length > 5 || !parts.some(Boolean))
    return undefined;
  const activeText = parts[4]?.toLocaleLowerCase('cs');
  return {
    ...(parts[0] ? { metAt: parts[0] } : {}),
    ...(parts[1] ? { meetingNote: parts[1] } : {}),
    ...(parts[2] ? { contactType: parts[2] } : {}),
    ...(parts[3] ? { followUp: parts[3] } : {}),
    ...(activeText
      ? {
          active: !['ne', 'no', 'false', '0', 'neaktivní'].includes(activeText),
        }
      : {}),
  };
};

const downloadPhoto = async (
  bot: Bot,
  token: string,
  fileId: string,
): Promise<Uint8Array> => {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram nevrátil cestu k fotografii.');
  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`,
  );
  if (!response.ok)
    throw new Error(`Stažení fotografie selhalo: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

export const networkHelp = `🤝 Network Bot

Pracuje s existujícím listem Network a přesně osmi sloupci: Name, Datum potkání, Místo potkání, Kontakt, Poznámka k potkání, Typ kontaktu, Domluvena další schůzka, Aktivní kontakt.

/network_add <popis> — připraví kontakt, zkontroluje duplicity a nabídne potvrzení
/network_search <dotaz> — významové hledání v kontaktech
/network_contact <jméno nebo ID> — detail kontaktu
/network_update <jméno nebo ID> | <změna> — změní právě jedno pole
/network_intro <jméno nebo ID> — doporučí možné propojení
/network_followups — aktivní kontakty s domluvenou další schůzkou
/network_context <místo> | <poznámka> | <typ> | <další schůzka> | <ano/ne> — doplní právě připravený kontakt

Můžete také poslat fotografii vizitky. Bot přečte jen viditelné údaje, připraví návrh a před uložením vyžádá potvrzení. Běžnou otázku jako „Znám někoho na účetnictví?“ můžete poslat i bez příkazu.`;

export const networkBotCommands = [
  { command: 'network_help', description: 'Návod k osobnímu networku' },
  { command: 'network_add', description: 'Připravit nový kontakt' },
  { command: 'network_search', description: 'Hledat v profesním networku' },
  { command: 'network_contact', description: 'Zobrazit detail kontaktu' },
  {
    command: 'network_update',
    description: 'Aktualizovat jedno pole kontaktu',
  },
  { command: 'network_intro', description: 'Doporučit možné propojení' },
  { command: 'network_followups', description: 'Vypsat domluvené follow-upy' },
] as const;

export const registerNetworkHandlers = (
  bot: Bot,
  dependencies: NetworkBotDependencies,
): void => {
  const pending = new Map<number, PendingContact>();
  const confirmationKeyboard = new InlineKeyboard()
    .text('Uložit', 'network:save')
    .text('Zrušit', 'network:cancel');

  const prepare = async (
    ctx: Context,
    draft: NetworkContactInput,
    source: PendingContact['source'],
  ): Promise<void> => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const duplicates = findDuplicateContacts(
      draft,
      await dependencies.repository.getContacts(),
    );
    pending.set(userId, { draft, duplicates, source });
    const duplicateText = duplicates.length
      ? `\n\nMožné duplicity:\n${duplicates.map((contact) => `- ${contact.name} (ID ${contact.id})`).join('\n')}\nUložení vytvoří nový řádek; existující záznam lze doplnit přes /network_update.`
      : '';
    const contextPrompt =
      source === 'business_card'
        ? '\n\nKde jste se potkali a co je důležité? Návrh můžete před uložením doplnit příkazem /network_context <místo> | <poznámka> | <typ> | <další schůzka> | <ano/ne>.'
        : '';
    await ctx.reply(
      `Návrh kontaktu:\n\n${formatContact(draft)}${duplicateText}${contextPrompt}`,
      { reply_markup: confirmationKeyboard },
    );
  };

  const runSearch = async (ctx: Context, query: string): Promise<void> => {
    const contacts = await dependencies.repository.getContacts();
    let matches: NetworkMatch[];
    try {
      matches = await dependencies.ai.search(query, contacts);
    } catch {
      matches = lexicalNetworkSearch(query, contacts);
    }
    await send(ctx, formatMatches(matches));
  };

  bot.command('network_help', (ctx) => send(ctx, networkHelp));
  bot.command('network_add', async (ctx) => {
    const description = ctx.match.trim();
    if (!description) {
      await ctx.reply('Použití: /network_add <jméno a kontext kontaktu>');
      return;
    }
    try {
      await prepare(
        ctx,
        await dependencies.ai.parseContact(description, today()),
        'manual',
      );
    } catch (error) {
      await ctx.reply(
        `Kontakt se nepodařilo připravit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('network_context', async (ctx) => {
    const userId = ctx.from?.id;
    const current = userId ? pending.get(userId) : undefined;
    const patch = parseContext(ctx.match);
    if (!userId || !current || !patch) {
      await ctx.reply(
        'Nejdřív připravte kontakt. Použití: /network_context <místo> | <poznámka> | <typ> | <další schůzka> | <ano/ne>',
      );
      return;
    }
    const updated = { ...current.draft, ...patch };
    pending.set(userId, { ...current, draft: updated });
    await ctx.reply(`Doplněný návrh:\n\n${formatContact(updated)}`, {
      reply_markup: confirmationKeyboard,
    });
  });
  bot.callbackQuery('network:save', async (ctx) => {
    const current = pending.get(ctx.from.id);
    if (!current) {
      await ctx.answerCallbackQuery({ text: 'Návrh už vypršel.' });
      return;
    }
    const saved = await dependencies.repository.createContact(current.draft);
    pending.delete(ctx.from.id);
    await ctx.answerCallbackQuery({ text: 'Uloženo' });
    await ctx.editMessageReplyMarkup();
    await ctx.reply(`Kontakt uložen.\n\n${formatContact(saved)}`);
  });
  bot.callbackQuery('network:cancel', async (ctx) => {
    pending.delete(ctx.from.id);
    await ctx.answerCallbackQuery({ text: 'Zrušeno' });
    await ctx.editMessageReplyMarkup();
  });
  bot.command('network_search', async (ctx) => {
    const query = ctx.match.trim();
    if (!query) {
      await ctx.reply(
        'Použití: /network_search <koho nebo jakou pomoc hledáte>',
      );
      return;
    }
    await runSearch(ctx, query);
  });
  bot.command('network_contact', async (ctx) => {
    const reference = ctx.match.trim();
    const contact = reference
      ? await findOne(dependencies.repository, reference)
      : undefined;
    await ctx.reply(
      contact ? formatContact(contact) : 'Kontakt nebyl nalezen.',
    );
  });
  bot.command('network_update', async (ctx) => {
    const separator = ctx.match.indexOf('|');
    if (separator < 1) {
      await ctx.reply(
        'Použití: /network_update <jméno nebo ID> | <jedna změna>',
      );
      return;
    }
    const reference = ctx.match.slice(0, separator).trim();
    const change = ctx.match.slice(separator + 1).trim();
    const contact = await findOne(dependencies.repository, reference);
    if (!contact) {
      await ctx.reply('Kontakt nebyl nalezen.');
      return;
    }
    try {
      const updated = await dependencies.repository.updateContact(
        contact.id,
        await dependencies.ai.parseUpdate(change),
      );
      await ctx.reply(`Kontakt aktualizován.\n\n${formatContact(updated)}`);
    } catch (error) {
      await ctx.reply(
        `Aktualizace selhala: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('network_intro', async (ctx) => {
    const reference = ctx.match.trim();
    const contact = reference
      ? await findOne(dependencies.repository, reference)
      : undefined;
    if (!contact) {
      await ctx.reply('Kontakt nebyl nalezen.');
      return;
    }
    const query = `Koho má smysl propojit s ${contact.name}? Hledej oboustranně doplňující potřeby a schopnosti. Výchozí kontakt: ${formatContact(contact)}`;
    const candidates = (await dependencies.repository.getContacts()).filter(
      (candidate) => candidate.id !== contact.id,
    );
    let matches: NetworkMatch[];
    try {
      matches = await dependencies.ai.search(query, candidates);
    } catch {
      matches = lexicalNetworkSearch(query, candidates);
    }
    await send(ctx, formatMatches(matches));
  });
  bot.command('network_followups', async (ctx) => {
    const contacts = (await dependencies.repository.getContacts()).filter(
      (contact) => contact.active && contact.followUp,
    );
    await send(
      ctx,
      contacts.length
        ? contacts
            .map(
              (contact) =>
                `${contact.name} — ${contact.followUp}\n/network_contact ${contact.id}`,
            )
            .join('\n\n')
        : 'Žádný aktivní kontakt nemá vyplněnou další schůzku.',
    );
  });
  bot.on('message:photo', async (ctx) => {
    if (!dependencies.cardParser) {
      await ctx.reply(
        'Čtení vizitek není nakonfigurované. Nastavte Ollama model s podporou obrazu.',
      );
      return;
    }
    const photo = ctx.message.photo.at(-1);
    if (!photo) return;
    if ((photo.file_size ?? 0) > 10 * 1024 * 1024) {
      await ctx.reply('Fotografie je příliš velká; maximum je 10 MB.');
      return;
    }
    try {
      await ctx.reply('Čtu viditelné údaje z vizitky…');
      const image = await downloadPhoto(
        bot,
        dependencies.telegramToken,
        photo.file_id,
      );
      await prepare(
        ctx,
        await dependencies.cardParser.parse(image),
        'business_card',
      );
    } catch (error) {
      await ctx.reply(
        `Vizitku se nepodařilo přečíst: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith('/')) return;
    await runSearch(ctx, text);
  });
};
