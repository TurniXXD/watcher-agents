import { Bot, type Context } from 'grammy';
import type { SalesStore } from '@watcher/database';
import {
  authorizationMiddleware,
  splitTelegramMessage,
} from '@watcher/telegram';
import type { SalesService } from './service.js';
import {
  renderLeadIntelligence,
  type SalesIntelligenceService,
} from './sales-intelligence.js';
import {
  renderSalesSearchListMessages,
  salesSearchCategorySummary,
  salesSearchResultKey,
} from './search-table.js';
import {
  registerNetworkHandlers,
  type NetworkBotDependencies,
} from '@watcher/contact-network';

export const salesHelp = `💼 Sales assistant

This private bot reviews discovered companies, prepares outreach drafts, and—when configured—syncs eligible, approved leads to Quickly and Twenty.

Getting started
1. Run /sales_status to check the current pipeline counts.
2. Run /sales_prospects <service> | <location> | [limit] to find up to 10 companies by default, enrich their public contacts, and idempotently add them to Twenty without a campaign. Example: /sales_prospects autoservis | Brno | 10
3. Run /sales_search <service> | <location> | <limit> to search immediately and save a periodic ARES + Geoapify search. Google Places is used only as an optional fallback. The first result and every newly discovered contact are sent as a simple list. Example: /sales_search autoservis | Brno | 15
4. To import candidates for later campaign analysis, run /sales_find <campaign-id> | <service> | <location> | <limit>. Example: /sales_find 5a... | autoservis | Brno | 15
5. Run /sales_run to audit newly discovered campaign websites, collect sourced public contacts, score the leads, and sync configured integrations.
6. Use /sales_calls to get the highest-scoring public phone contacts, or /sales_leads for all recent campaign leads.
7. Review the complete campaign record with /sales_lead <id>.
8. Use /sales_approve <id> or /sales_reject <id> only after reviewing the company, contact evidence, draft, and outreach basis.

Commands
/start — show this guide
/help or /sales_help — show this guide
/about or /sales_about — explain what the bot does, how data moves, integrations, limits, and safety boundaries
/sales_status — show campaign count, recent leads, qualified leads, and Quickly enrollments
/sales_campaigns — list campaign IDs needed by /sales_find
/sales_prospects <service> | <location> | [limit] — add deduplicated researched companies directly to Twenty without a campaign; default 10
/sales_search <service> | <location> | <limit> — search immediately, save the periodic search, and print new contacts as a simple list
/sales_searches — list active periodic searches
/sales_search_stop <id|all> — stop one or all periodic searches
/sales_find <campaign-id> | <service> | <location> | <limit> — run the same combined discovery and import candidates with an official website
/sales_calls [limit] — list researched leads that have a public phone and its source page, ranked by score
/sales_leads — list the 10 most recent leads with IDs, stages, and scores
/sales_lead <id> — show one lead's company details, public contact data and source, draft, and current Quickly eligibility
/sales_approve <id> — record manual approval; the lead is enrolled only if every remaining eligibility check passes
/sales_reject <id> — reject the lead so it is not enrolled
/sales_run — immediately run discovery, analysis, scoring, and configured CRM/email synchronization
/lead <url> — safely analyze a public website and create or enrich the deduplicated CRM lead
/lead_analysis <lead-id> — show the cached detailed intelligence report
/lead_refresh <lead-id> — force a fresh website research run
/leads_today — show today's reserved reports without creating another batch
/leads_next — preview the next five eligible leads without reserving them
/leads_stats — show contacted, uncontacted, suggested, and delivery counts

Lead stages and integrations
QUALIFIED means the automated checks passed; it is not approval to contact. SYNCED_TO_QUICKLY means the lead was enrolled in Quickly. Quickly and Twenty synchronization stays inactive until their API keys are configured. A partial run can still keep valid results when one provider fails.

Safety and compliance
Approval records an operator decision only. It does not establish consent, legitimate interest, or any other legal basis. A public company phone is research evidence, not automatic permission to call. Verify the recipient, source, suppression/reply state, local law, campaign settings, and final copy before outreach. Never treat generated text or discovered contact data as automatically safe to use.`;

export const salesAbout = `💼 O Sales assistantovi

Účel
Sales assistant je soukromý operátorský bot pro řízené zpracování B2B leadů. Pomáhá převzít firmy z nakonfigurovaného zdroje, dohledat veřejné kontaktní údaje, vyhodnotit obchodní relevanci, připravit návrh prvního oslovení a synchronizovat způsobilé záznamy do CRM a e-mailové platformy. Není to autonomní spamovací nástroj.

Jak data procházejí systémem
1. /sales_prospects provede jednorázové hledání bez kampaně, vezme pouze kandidáty s webem, dohledá veřejný e-mail a telefon, uloží jejich zdroj a idempotentně vytvoří nebo aktualizuje Company v Twenty. Watcher PostgreSQL hlídá duplicity podle identity zdroje, domény a IČO; opakované hledání již synchronizovanou firmu znovu nevytvoří. Kontakty a odkazy jsou v Twenty uložené v nativní Note navázané na Company. Tento tok nic neposílá do Quickly.
2. /sales_search kombinuje veřejný ARES s Geoapify. Běžný český nebo anglický popis oboru nejprve přeloží na ověřené Geoapify kategorie a podle dostupnosti také na CZ-NACE: známé výrazy řeší deterministický slovník a ostatní nakonfigurovaná Ollama. Použité kategorie bot vždy vypíše nad výsledkem. ARES vrací aktivní české subjekty, IČO, sídlo a CZ-NACE; Geoapify vrací provozovny a dostupný veřejný telefon, e-mail a web z OpenStreetMap. Google Places se zavolá jen jako volitelný fallback, pokud je nakonfigurovaný a primární zdroje nemají dost kontaktních výsledků. Hledání se uloží do PostgreSQL a opakuje podle SALES_INTERVAL_MINUTES. První výsledek a každý později nalezený nový kontakt bot pošle jako TSV tabulku; již oznámené kontakty neopakuje. Výsledky se tímto krokem neukládají do kampaně, CRM ani Quickly.
3. /sales_find provede stejné kombinované hledání pro zvolenou kampaň. Výsledky deduplikuje podle IČO, domény a identity zdroje, ale importuje jen kandidáty s webem, protože následný audit vyžaduje oficiální web. Alternativně discovery načte JSON feed kampaně nebo přijme lead přes Sales API.
4. /sales_run navštíví veřejný firemní web, hledá kontaktní stránku, veřejný e-mail a telefon v explicitním tel: odkazu a ke kontaktu ukládá přesnou zdrojovou URL. Nečte telefon z volného textu a nepřebírá jej automaticky z katalogu.
5. Sdílený ARES klient použitý Sales i OSINT botem zkusí přesnou shodu registrovaného názvu a doplní kandidátní IČO. Nejednoznačná nebo chybějící shoda se nepotvrdí a shoda v ARES sama nedokazuje vlastnictví webu.
6. Bot určí zemi z explicitní adresy, rejstříku, discovery metadat nebo telefonní předvolby. Doména .cz je jen slabý signál. Primární jazyk určí přednostně z HTML lang, discovery metadat a obsahu webu; uloží také alternativní jazyky, zdroj a confidence. Pro oslovení použije spolehlivý primární jazyk webu, u české firmy bez jistého výsledku češtinu a jinak angličtinu.
7. Deterministické skóre se skládá z relevance ručně zadanému discovery dotazu (max. 25), zjištěné potřeby na webu (max. 30), dosažitelnosti veřejným telefonem/e-mailem (max. 20) a síly zdrojů včetně přesné ARES shody (max. 15). Kvalifikační práh kampaně je standardně 70.
8. /sales_calls zobrazí analyzované nezamítnuté leady s veřejným telefonem a zdrojem, seřazené podle skóre. Stejných nejvýše 20 kontaktů bot automaticky posílá večer před následujícím pracovním dnem bez závislosti na Quickly nebo odeslaných e-mailech. Tento seznam je pro ruční kontrolu a cold cally; není důkazem právního titulu.
9. Je-li nastaven Ollama, bot sestaví verzovaný cold-email prompt pouze z ověřených faktů, vyžádá strukturovaný JSON a zkontroluje Zod schema, jazyk, délku, jedinou nízkotlakou otázku a přesnou shodu personalizačního faktu. Neplatný výstup opraví nejvýše jedním omezeným retry. Bez Ollama použije původní deterministickou šablonu kampaně.
10. Návrh, model, verzi promptu, jazyk, confidence a použitý fakt uloží k leadu. Návrh se tímto krokem neposílá.
11. Operátor zkontroluje firmu, zdroj kontaktu, skóre, text a důvod oprávnění ke kontaktu.
12. Schválený lead se odešle do Quickly pouze tehdy, když projde všemi kontrolami způsobilosti.
13. Twenty uchovává idempotentně dohledanou nebo vytvořenou Company a návrh jako nativní Note. Quickly řídí e-mailovou kampaň, odesílací schránku, sekvence a reakce.

První nastavení discovery
1. ARES nevyžaduje API key a zůstává aktivní vždy. Pro známé obory bot mapuje běžný text slovníkem; například „farmy“ znamenají Geoapify commercial.food_and_drink.farm a CZ-NACE 01. Ostatní přirozené popisy mapuje nakonfigurovaná Ollama do omezeného katalogu platných Geoapify kategorií. Přesný ARES filtr lze stále zadat jako nace:95310. Pokud překlad nenajde CZ-NACE, ARES hledá původní text v obchodním názvu.
2. V Geoapify vytvoř bezplatný API key a na VPS nastav GEOAPIFY_API_KEY v tajném sales-bot.env. Geoapify je primární zdroj provozoven a kontaktů. Klíč neposílej do Telegramu ani do repozitáře.
3. Volitelně nastav GOOGLE_PLACES_API_KEY. Google se použije pouze jako fallback pro chybějící kontaktní výsledky; bez klíče bot normálně funguje přes ARES a Geoapify. Potom znovu nasaď nebo restartuj sales-bot.
4. Existující UUID vypíše /sales_campaigns. Novou kampaň vytvoř z VPS přes Sales API:
curl -X POST http://127.0.0.1:4050/v1/campaigns -H "Authorization: Bearer $SALES_API_TOKEN" -H "Content-Type: application/json" --data '{"name":"Brno autoservisy","offer":"modernizace webu","subjectTemplate":"Nápad pro {{company}}","bodyTemplate":"Dobrý den, {{observation}} Nabízíme {{offer}}."}'
Kampaň může zůstat disabled pro čistý research; enabled ovládá odesílání, ne analýzu.
5. Pro přímý import prospektů do Twenty bez kampaně spusť /sales_prospects autoservis | Brno | 10. Twenty musí být nakonfigurované; opakovaný běh stejnou firmu nevytvoří podruhé.
6. Pro okamžitý výpis a založení periodického hledání spusť /sales_search autoservis | Brno | 15. Aktivní hledání vypíše /sales_searches a zastaví /sales_search_stop <id|all>. Horské chaty jsou mapované na Geoapify kategorie accommodation.hut + accommodation.chalet a CZ-NACE 55200, takže funguje například /sales_search horské chaty | Moravskoslezský kraj | 15. Pro přesný obor lze použít /sales_search nace:95310 | Brno | 15 nebo Geoapify kategorii ve tvaru geo:service.vehicle.repair.car.
7. Pro import spusť /sales_find <campaign-id> | autoservis | Brno | 15, potom /sales_run a /sales_calls 20. Detail a původ každého uloženého kontaktu ověříš přes /sales_lead <id>.

Zdroje a hranice discovery
ARES poskytuje registrované subjekty a sídla, nikoli spolehlivý katalog provozoven nebo kontaktů. Přesný filtr ARES funguje nejlépe pro obec; při zadání celého kraje může být ARES část prázdná a provozovny dodá Geoapify přes hranici daného kraje. Geoapify používá komunitní OpenStreetMap data, která mohou být neúplná nebo zastaralá; výsledky musí uvádět atribuci. Google Places je pouze volitelný fallback. ARES shoda názvu sama nedokazuje vlastnictví webu a sídlo nemusí být provozovna. Webový audit pracuje s oficiálním webem kandidáta. Firmy.cz se automaticky nescrapuje; bot neobchází roboty, přihlášení ani placené databáze.

Integrace
• Twenty CRM: Company se hledá v pořadí doména → registrační ID/IČO → externí ID → jméno+země a pak se aktualizuje nebo vytvoří. Návrh e-mailu je nativní Note navázaná na Company; stejný lead poznámku aktualizuje místo vytváření duplikátu. Reusable integrace podporuje také Person, Opportunity, Task, Relationship a Referral, ale pipeline nevymýšlí osobu ani automaticky nevytváří obchodní příležitost. Vlastní pole fungují po instalaci Twenty Sales app a zapnutí TWENTY_APP_FIELDS_ENABLED. Twenty samo v tomto workflow e-mail neodesílá.
• Ollama: volitelně generuje pouze draft přes sdílený provider. Dynamický obsah je oddělen od instrukcí, výstup je validovaný a při nedostatku podkladů musí model personalizaci přiznaně vynechat. Chyba modelu neznamená, že se smí odeslat neověřený text.
• Quickly: přijímá e-mail, jméno a vygenerované hodnoty subject/body. Finální sekvence, časování, limity a odesílací schránka se spravují v Quickly.
• Telegram: slouží jako soukromé administrační rozhraní pro kontrolu stavu, leadů, schválení a ruční spuštění běhu.
• Sales API: umožňuje spravovat kampaně, leady a doložení oprávnění mimo Telegram.

Co znamenají stavy
QUALIFIED znamená, že lead prošel automatickým hodnocením; neznamená souhlas s kontaktováním. APPROVED vyjadřuje rozhodnutí operátora; samo o sobě nezakládá právní titul. SYNCED_TO_QUICKLY znamená, že lead byl předán do Quickly, nikoli že byl e-mail úspěšně doručen nebo že příjemce odpověděl.

Podmínky odeslání
Bot vyžaduje kvalifikovaný lead, syntakticky platnou adresu, ruční schválení, evidovaný a platný RECIPIENT_OPT_IN nebo EXISTING_CUSTOMER, nepřítomnost suppression/reply blokace, aktivní kampaň, Quickly campaign ID, volnou denní kapacitu a funkční Quickly konfiguraci. Veřejně nalezený e-mail ani /sales_approve tyto podmínky nenahrazují.

Omezení a odpovědnost
Automatické skóre, detekce jazyka i návrh textu mohou být chybné. Bot nepotvrzuje totožnost příjemce, aktuálnost webu, doručitelnost adresy ani zákonnost kampaně. Nevytváří graph database, neprochází autonomně vztahové grafy, neplatí referral provize a nespouští autonomní odesílání. Před odesláním vždy ověř zdroj, příjemce, právní základ, místní pravidla, suppression stav a finální znění. Přístup je omezen na povolená Telegram user ID a tajné klíče se nespravují přes Telegram.

Použití
Pracovní postup a všechny dostupné příkazy zobrazíš přes /sales_help. Aktuální stav integrací a pipeline ověříš přes /sales_status. Každé hledání zapisuje „Sales business search started“, samostatný výsledek ARES a Geoapify v „Sales discovery source completed“, rozhodnutí o Google fallbacku a závěrečné počty podle provideru. V logu tak uvidíš rozpoznaný CZ-NACE/Geoapify category, stav completed/skipped/failed, skipReason, dobu trvání a počet kontaktních výsledků. Když /sales_run vrátí 0 discovered, ale /sales_find našel kandidáty, sleduj hlavně analyzed: discovery count v runu označuje pouze JSON feed; ruční Places import je vypsán už příkazem /sales_find.`;

export const salesBotCommands = [
  { command: 'sales_help', description: 'Detailní návod a všechny příkazy' },
  { command: 'sales_about', description: 'Účel, integrace, stavy a omezení' },
  {
    command: 'sales_status',
    description: 'Stav kampaní, leadů a synchronizace',
  },
  { command: 'sales_campaigns', description: 'ID a stav Sales kampaní' },
  {
    command: 'sales_prospects',
    description: 'Přidat prospekty přímo do Twenty',
  },
  {
    command: 'sales_search',
    description: 'Hledat firmy nyní i periodicky',
  },
  { command: 'sales_searches', description: 'Aktivní periodická hledání' },
  {
    command: 'sales_search_stop',
    description: 'Zastavit periodické hledání',
  },
  { command: 'sales_find', description: 'Najít firmy podle oboru a lokality' },
  { command: 'sales_calls', description: 'Kontakty pro ruční cold cally' },
  { command: 'sales_leads', description: 'Posledních 10 leadů' },
  { command: 'sales_lead', description: 'Detail leadu: /sales_lead <id>' },
  {
    command: 'sales_approve',
    description: 'Schválit lead: /sales_approve <id>',
  },
  {
    command: 'sales_reject',
    description: 'Zamítnout lead: /sales_reject <id>',
  },
  { command: 'sales_run', description: 'Spustit Sales pipeline nyní' },
  { command: 'lead', description: 'Přidat nebo obohatit lead z URL' },
  { command: 'lead_analysis', description: 'Zobrazit analýzu leadu' },
  { command: 'lead_refresh', description: 'Obnovit analýzu leadu' },
  { command: 'leads_today', description: 'Dnešní Sales intelligence' },
  { command: 'leads_next', description: 'Náhled dalších 5 leadů' },
  { command: 'leads_stats', description: 'Statistiky Sales intelligence' },
] as const;

const send = async (ctx: Context, message: string) => {
  for (const part of splitTelegramMessage(message, 3900)) {
    await ctx.reply(part);
  }
};

const sendSearchTable = async (
  ctx: Context,
  messages: readonly string[],
): Promise<void> => {
  for (const message of messages) {
    await ctx.reply(message, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
};

export const parseSalesFind = (
  value: string,
):
  | { campaignId: string; query: string; locality: string; limit: number }
  | undefined => {
  const parts = value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const limit = parts[3] === undefined ? 10 : Number(parts[3]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return undefined;
  const [campaignId, query, locality] = parts;
  if (
    !campaignId ||
    !query ||
    !locality ||
    campaignId.length > 100 ||
    query.length > 120 ||
    locality.length > 120
  )
    return undefined;
  return { campaignId, query, locality, limit };
};

export const parseSalesSearch = (
  value: string,
): { query: string; locality: string; limit: number } | undefined => {
  const parts = value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return undefined;
  const limit = parts[2] === undefined ? 10 : Number(parts[2]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return undefined;
  const [query, locality] = parts;
  if (!query || !locality || query.length > 120 || locality.length > 120)
    return undefined;
  return { query, locality, limit };
};

export const createSalesBot = (
  token: string,
  allowedUserIds: ReadonlySet<number>,
  store: SalesStore,
  service: SalesService,
  network?: NetworkBotDependencies,
  searchIntervalMinutes = 30,
  intelligence?: SalesIntelligenceService,
  timezone = 'Europe/Prague',
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedUserIds));
  bot.command(['start', 'help', 'sales_help'], (ctx) => send(ctx, salesHelp));
  bot.command(['about', 'sales_about'], (ctx) => send(ctx, salesAbout));
  bot.command('sales_status', async (ctx) => {
    const [campaigns, leads, searches, prospects] = await Promise.all([
      store.listCampaigns(),
      store.listLeads(undefined, 100),
      store.listSearchSubscriptions(BigInt(ctx.chat.id)),
      store.countProspects(),
    ]);
    await ctx.reply(
      `Campaigns: ${campaigns.length}; CRM prospects: ${prospects}; periodic searches: ${searches.length}; recent leads: ${leads.length}; qualified: ${leads.filter((lead) => lead.stage === 'QUALIFIED').length}; Quickly enrolled: ${leads.filter((lead) => lead.stage === 'SYNCED_TO_QUICKLY').length}; Twenty: ${service.twentyConfigured ? 'configured' : 'missing configuration'}; Discovery: ARES active, Geoapify ${service.geoapifyConfigured ? 'configured' : 'missing GEOAPIFY_API_KEY'}, Google fallback ${service.googlePlacesConfigured ? 'configured' : 'disabled'}.`,
    );
  });
  bot.command('sales_campaigns', async (ctx) => {
    const campaigns = await store.listCampaigns();
    await send(
      ctx,
      campaigns.length
        ? campaigns
            .map(
              (campaign) =>
                `${campaign.id} · ${campaign.name} · research available · sending ${campaign.enabled ? 'enabled' : 'disabled'} · minimum ${campaign.minimumLeadScore} pts`,
            )
            .join('\n')
        : 'Žádná Sales kampaň. Postup vytvoření přes API je v /sales_about.',
    );
  });
  bot.command('sales_prospects', async (ctx) => {
    const input = parseSalesSearch(ctx.match);
    if (!input) {
      await ctx.reply(
        'Použití: /sales_prospects <obor/služba> | <lokalita> | [limit 1–20]\nPříklad: /sales_prospects autoservis | Brno | 10',
      );
      return;
    }
    try {
      await ctx.reply(
        'Hledám firmy, ověřuji weby a ukládám nové prospekty do Twenty…',
      );
      const result = await service.syncProspects(input);
      const failureDetails = result.failures.length
        ? `\nNeúspěšné: ${result.failures
            .map(({ companyName, error }) => `${companyName}: ${error}`)
            .join('; ')}`
        : '';
      await send(
        ctx,
        `${salesSearchCategorySummary(input.query, result.category)}\n\nProspekty dokončeny: ${result.found} nalezeno, ${result.withWebsite} s webem, ${result.created} nových záznamů v DB, ${result.synced} synchronizováno do Twenty, ${result.alreadyPresent} již dříve přidáno, ${result.failures.length} selhání.${failureDetails}`,
      );
    } catch (error) {
      await ctx.reply(
        `Import prospektů selhal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('sales_search', async (ctx) => {
    const input = parseSalesSearch(ctx.match);
    if (!input) {
      await ctx.reply(
        'Použití: /sales_search <obor/služba> | <lokalita> | <limit 1–20>\nPříklad: /sales_search autoservis | Brno | 15',
      );
      return;
    }
    if (!ctx.from) {
      await ctx.reply('Hledání lze založit jen zprávou od Telegram uživatele.');
      return;
    }
    let subscriptionId: string | undefined;
    try {
      const subscription = await store.upsertSearchSubscription({
        telegramChatId: BigInt(ctx.chat.id),
        telegramUserId: BigInt(ctx.from.id),
        query: input.query,
        locality: input.locality,
        resultLimit: input.limit,
        intervalMinutes: searchIntervalMinutes,
      });
      subscriptionId = subscription.id;
      await ctx.reply(
        `Hledám firmy v ARES a Geoapify; Google použiji jen jako nakonfigurovaný fallback. Hledání ukládám a zopakuji každých ${searchIntervalMinutes} minut…`,
      );
      const { companies, category } =
        await service.searchBusinessesDetailed(input);
      if (companies.length > 0) {
        await sendSearchTable(
          ctx,
          renderSalesSearchListMessages(
            companies,
            input.query,
            input.locality,
            category,
          ),
        );
      } else {
        await ctx.reply(
          `${salesSearchCategorySummary(input.query, category)}\n\nPro „${input.query}“ v lokalitě ${input.locality} nyní nebyly nalezeny žádné firmy. Periodické hledání ${subscription.id} zůstává aktivní.`,
        );
      }
      await store.completeSearchSubscription(
        subscription.id,
        companies.map(salesSearchResultKey),
      );
      await ctx.reply(
        `Periodické hledání je aktivní: ${subscription.id}. Bot pošle pouze nové kontakty. Zastavení: /sales_search_stop ${subscription.id}`,
      );
    } catch (error) {
      if (subscriptionId) {
        await store.failSearchSubscription(
          subscriptionId,
          error instanceof Error ? error.message : String(error),
        );
      }
      await ctx.reply(
        `Hledání selhalo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('sales_searches', async (ctx) => {
    const searches = await store.listSearchSubscriptions(BigInt(ctx.chat.id));
    await send(
      ctx,
      searches.length
        ? searches
            .map(
              (search) =>
                `${search.id} · ${search.query} · ${search.locality} · každých ${search.intervalMinutes} min · další běh ${search.nextRunAt.toISOString()}${search.lastError ? ` · poslední chyba: ${search.lastError}` : ''}`,
            )
            .join('\n')
        : 'Žádná aktivní periodická hledání.',
    );
  });
  bot.command('sales_search_stop', async (ctx) => {
    const selector = ctx.match.trim();
    if (!selector) {
      await ctx.reply('Použití: /sales_search_stop <id|all>');
      return;
    }
    const stopped = await store.disableSearchSubscriptions(
      BigInt(ctx.chat.id),
      selector.toLowerCase() === 'all' ? undefined : selector,
    );
    await ctx.reply(
      stopped > 0
        ? `Zastaveno periodických hledání: ${stopped}.`
        : 'Odpovídající aktivní hledání nebylo nalezeno.',
    );
  });
  bot.command('sales_find', async (ctx) => {
    const input = parseSalesFind(ctx.match);
    if (!input) {
      await ctx.reply(
        'Použití: /sales_find <campaign-id> | <obor/služba> | <lokalita> | <limit 1–20>\nPříklad: /sales_find 5a... | autoservis | Brno | 15',
      );
      return;
    }
    try {
      await ctx.reply(
        'Hledám firmy přes ARES a Geoapify; Google je pouze volitelný fallback…',
      );
      const result = await service.discoverBusinesses(input);
      await ctx.reply(
        `Discovery dokončeno: ${result.found} kandidátů nalezeno, ${result.imported} s webem importováno nebo deduplikováno. Spusť /sales_run pro audit webů a potom /sales_calls.`,
      );
    } catch (error) {
      await ctx.reply(
        `Discovery selhalo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('sales_calls', async (ctx) => {
    const requested = ctx.match.trim() ? Number(ctx.match.trim()) : 20;
    if (!Number.isInteger(requested) || requested < 1 || requested > 50) {
      await ctx.reply('Použití: /sales_calls [limit 1–50]');
      return;
    }
    const leads = await store.listCallCandidates(requested);
    await send(
      ctx,
      leads.length
        ? `📞 Kontakty pro ruční cold cally (${leads.length})\nVeřejný telefon ani skóre samy nezakládají oprávnění volat. Před použitím ověř zdroj a místní pravidla.\n\n${leads
            .map(
              (lead, index) =>
                `${index + 1}. ${lead.companyName} · ${lead.finalScore ?? '?'} pts · ${lead.stage}\nTelefon: ${lead.phone}\nZdroj: ${lead.phoneSourceUrl}\nWeb: ${lead.websiteUrl ?? 'není'}\nKampaň: ${lead.campaign.name}\nDetail: /sales_lead ${lead.id}`,
            )
            .join('\n\n')}`
        : 'Žádné analyzované leady s veřejným tel: kontaktem. Spusť /sales_find a potom /sales_run.',
    );
  });
  bot.command('sales_leads', async (ctx) => {
    const leads = await store.listLeads(undefined, 10);
    await ctx.reply(
      leads.length
        ? leads
            .map(
              (lead) =>
                `${lead.id} · ${lead.companyName} · ${lead.stage} · ${lead.finalScore ?? '?'} pts`,
            )
            .join('\n')
        : 'No leads yet.',
    );
  });
  bot.command('sales_lead', async (ctx) => {
    const id = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    const check = await service.eligibility(id);
    if (!check) {
      await ctx.reply('Lead not found.');
      return;
    }
    const lead = check.lead;
    await ctx.reply(
      `${lead.companyName} · ${lead.stage} · ${lead.finalScore ?? '?'} pts\n${lead.websiteUrl ?? ''}\nEmail: ${lead.email ?? 'not found'}\nPhone: ${lead.phone ?? 'not found'}\nSource: ${lead.phoneSourceUrl ?? lead.contactSourceUrl ?? lead.sourceUrl ?? 'feed'}\n\nDraft:\n${lead.draftSubject ?? '(not ready)'}\n${lead.draftBody ?? ''}\n\nQuickly eligibility: ${check.eligible ? 'ready' : check.reasons.join(', ')}`.slice(
        0,
        3900,
      ),
    );
  });
  bot.command('lead', async (ctx) => {
    if (!intelligence)
      return void (await ctx.reply('Sales intelligence není nakonfigurovaná.'));
    try {
      const lead = await intelligence.link(ctx.match);
      await send(
        ctx,
        `Lead ${lead.companyName} byl vytvořen nebo obohacen bez změny historie a stavu.\n${lead.email ? `E-mail: ${lead.email}\n` : ''}${lead.phone ? `Telefon: ${lead.phone}\n` : ''}Detail: /lead_analysis ${lead.id}`,
      );
    } catch (error) {
      await ctx.reply(
        `Lead se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  const showAnalysis = async (ctx: Context, refresh: boolean) => {
    if (!intelligence)
      return void (await ctx.reply('Sales intelligence není nakonfigurovaná.'));
    const id = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!id)
      return void (await ctx.reply(
        `Použití: /lead_${refresh ? 'refresh' : 'analysis'} <lead-id>`,
      ));
    try {
      const lead = await intelligence.research(id, refresh);
      for (const part of renderLeadIntelligence(
        lead,
        undefined,
        intelligence.crmUrl(lead),
      ))
        await ctx.reply(part, {
          link_preview_options: { is_disabled: true },
        });
    } catch (error) {
      await ctx.reply(
        `Analýza selhala: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  bot.command('lead_analysis', (ctx) => showAnalysis(ctx, false));
  bot.command('lead_refresh', (ctx) => showAnalysis(ctx, true));
  const localDay = () => {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return new Date(`${day}T00:00:00.000Z`);
  };
  bot.command('leads_today', async (ctx) => {
    const assignments = await store.listDailySuggestions(localDay());
    if (!assignments.length)
      return void (await ctx.reply(
        'Pro dnešek zatím nejsou přiřazené žádné leady.',
      ));
    for (const [index, assignment] of assignments.entries()) {
      const lead = assignment.lead;
      if (!lead.research) {
        await ctx.reply(
          `${index + 1}. ${lead.companyName} — analýza zatím není dostupná.`,
        );
        continue;
      }
      for (const part of renderLeadIntelligence(
        lead,
        `${index + 1}/${assignments.length}`,
        intelligence?.crmUrl(lead),
      ))
        await ctx.reply(part, {
          link_preview_options: { is_disabled: true },
        });
    }
  });
  bot.command('leads_next', async (ctx) => {
    const leads = await store.previewDailySuggestions(5);
    await ctx.reply(
      leads.length
        ? `Náhled bez rezervace:\n${leads.map((lead, index) => `${index + 1}. ${lead.companyName} · ${lead.stage} · vytvořen ${lead.createdAt.toISOString().slice(0, 10)}`).join('\n')}`
        : 'Žádný způsobilý lead.',
    );
  });
  bot.command('leads_stats', async (ctx) => {
    const stats = await store.salesIntelligenceStats(localDay());
    await ctx.reply(
      `CRM leady: ${stats.total}\nKontaktované: ${stats.contacted}\nNekontaktované: ${stats.uncontacted}\nNikdy nenavržené: ${stats.neverSuggested}\nDříve navržené: ${stats.previouslySuggested}\nČekající na outreach: ${stats.awaitingOutreach}\nDnešní dávka: ${stats.today.length} (${stats.today.filter((item) => item.status === 'delivered').length} doručeno)`,
    );
  });
  bot.command('sales_approve', async (ctx) => {
    const lead = await store.decideLead(
      ctx.match.trim(),
      true,
      'TELEGRAM',
      String(ctx.from?.id),
    );
    const check = await service.eligibility(lead.id);
    await ctx.reply(
      `Approved ${lead.companyName}. ${check?.eligible ? 'Eligible for Quickly on next run.' : `Quickly still blocked: ${check?.reasons.join(', ') ?? 'unknown'}`}`,
    );
  });
  bot.command('sales_reject', async (ctx) => {
    const lead = await store.decideLead(
      ctx.match.trim(),
      false,
      'TELEGRAM',
      String(ctx.from?.id),
    );
    await ctx.reply(`Rejected ${lead.companyName}.`);
  });
  bot.command('sales_run', async (ctx) => {
    await ctx.reply('Sales run started.');
    const result = await service.run();
    await ctx.reply(
      `Sales run complete: ${result.discovered} discovered, ${result.analyzed} analyzed, ${result.synced} enrolled, ${result.failures} failures.`,
    );
  });
  if (network) registerNetworkHandlers(bot, network);
  bot.catch((error) => {
    console.error('Sales Telegram error', error.error);
  });
  return bot;
};
