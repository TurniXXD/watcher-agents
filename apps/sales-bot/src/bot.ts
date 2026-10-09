import { Bot, type Context } from 'grammy';
import type { SalesStore } from '@watcher/database';
import {
  authorizationMiddleware,
  splitTelegramMessage,
} from '@watcher/telegram';
import type { SalesService } from './service.js';
import {
  registerNetworkHandlers,
  type NetworkBotDependencies,
} from './network/index.js';

export const salesHelp = `💼 Sales assistant

This private bot reviews discovered companies, prepares outreach drafts, and—when configured—syncs eligible, approved leads to Quickly and Twenty.

Getting started
1. Run /sales_status to check the current pipeline counts.
2. Run /sales_search <service> | <location> | <limit> for a one-off ARES + Geoapify search printed directly in Telegram, without a campaign or database import. Google Places is used only as an optional fallback. Example: /sales_search autoservis | Brno | 15
3. To import candidates for later analysis, run /sales_find <campaign-id> | <service> | <location> | <limit>. Example: /sales_find 5a... | autoservis | Brno | 15
4. Run /sales_run to audit newly discovered websites, collect sourced public contacts, score the leads, and sync configured integrations.
5. Use /sales_calls to get the highest-scoring public phone contacts, or /sales_leads for all recent leads.
6. Review the complete record with /sales_lead <id>.
7. Use /sales_approve <id> or /sales_reject <id> only after reviewing the company, contact evidence, draft, and outreach basis.

Commands
/help or /sales_help — show this guide
/about or /sales_about — explain what the bot does, how data moves, integrations, limits, and safety boundaries
/sales_status — show campaign count, recent leads, qualified leads, and Quickly enrollments
/sales_campaigns — list campaign IDs needed by /sales_find
/sales_search <service> | <location> | <limit> — combine ARES and Geoapify and print up to 20 companies without a campaign or database import; Google is an optional fallback
/sales_find <campaign-id> | <service> | <location> | <limit> — run the same combined discovery and import candidates with an official website
/sales_calls [limit] — list researched leads that have a public phone and its source page, ranked by score
/sales_leads — list the 10 most recent leads with IDs, stages, and scores
/sales_lead <id> — show one lead's company details, public contact data and source, draft, and current Quickly eligibility
/sales_approve <id> — record manual approval; the lead is enrolled only if every remaining eligibility check passes
/sales_reject <id> — reject the lead so it is not enrolled
/sales_run — immediately run discovery, analysis, scoring, and configured CRM/email synchronization

Lead stages and integrations
QUALIFIED means the automated checks passed; it is not approval to contact. SYNCED_TO_QUICKLY means the lead was enrolled in Quickly. Quickly and Twenty synchronization stays inactive until their API keys are configured. A partial run can still keep valid results when one provider fails.

Safety and compliance
Approval records an operator decision only. It does not establish consent, legitimate interest, or any other legal basis. A public company phone is research evidence, not automatic permission to call. Verify the recipient, source, suppression/reply state, local law, campaign settings, and final copy before outreach. Never treat generated text or discovered contact data as automatically safe to use.`;

export const salesAbout = `💼 O Sales assistantovi

Účel
Sales assistant je soukromý operátorský bot pro řízené zpracování B2B leadů. Pomáhá převzít firmy z nakonfigurovaného zdroje, dohledat veřejné kontaktní údaje, vyhodnotit obchodní relevanci, připravit návrh prvního oslovení a synchronizovat způsobilé záznamy do CRM a e-mailové platformy. Není to autonomní spamovací nástroj.

Jak data procházejí systémem
1. /sales_search kombinuje veřejný ARES s Geoapify. ARES vrací aktivní české subjekty, IČO, sídlo a CZ-NACE; Geoapify vrací provozovny a dostupný veřejný telefon, e-mail a web z OpenStreetMap. Google Places se zavolá jen jako volitelný fallback, pokud je nakonfigurovaný a primární zdroje nemají dost kontaktních výsledků. Výpis nevyžaduje kampaň a nic neukládá do databáze, CRM ani Quickly.
2. /sales_find provede stejné kombinované hledání pro zvolenou kampaň. Výsledky deduplikuje podle IČO, domény a identity zdroje, ale importuje jen kandidáty s webem, protože následný audit vyžaduje oficiální web. Alternativně discovery načte JSON feed kampaně nebo přijme lead přes Sales API.
3. /sales_run navštíví veřejný firemní web, hledá kontaktní stránku, veřejný e-mail a telefon v explicitním tel: odkazu a ke kontaktu ukládá přesnou zdrojovou URL. Nečte telefon z volného textu a nepřebírá jej automaticky z katalogu.
4. Sdílený ARES klient použitý Sales i OSINT botem zkusí přesnou shodu registrovaného názvu a doplní kandidátní IČO. Nejednoznačná nebo chybějící shoda se nepotvrdí a shoda v ARES sama nedokazuje vlastnictví webu.
5. Bot určí zemi z explicitní adresy, rejstříku, discovery metadat nebo telefonní předvolby. Doména .cz je jen slabý signál. Primární jazyk určí přednostně z HTML lang, discovery metadat a obsahu webu; uloží také alternativní jazyky, zdroj a confidence. Pro oslovení použije spolehlivý primární jazyk webu, u české firmy bez jistého výsledku češtinu a jinak angličtinu.
6. Deterministické skóre se skládá z relevance ručně zadanému discovery dotazu (max. 25), zjištěné potřeby na webu (max. 30), dosažitelnosti veřejným telefonem/e-mailem (max. 20) a síly zdrojů včetně přesné ARES shody (max. 15). Kvalifikační práh kampaně je standardně 70.
7. /sales_calls zobrazí analyzované nezamítnuté leady s veřejným telefonem a zdrojem, seřazené podle skóre. Stejných nejvýše 20 kontaktů bot automaticky posílá večer před následujícím pracovním dnem bez závislosti na Quickly nebo odeslaných e-mailech. Tento seznam je pro ruční kontrolu a cold cally; není důkazem právního titulu.
8. Je-li nastaven Ollama, bot sestaví verzovaný cold-email prompt pouze z ověřených faktů, vyžádá strukturovaný JSON a zkontroluje Zod schema, jazyk, délku, jedinou nízkotlakou otázku a přesnou shodu personalizačního faktu. Neplatný výstup opraví nejvýše jedním omezeným retry. Bez Ollama použije původní deterministickou šablonu kampaně.
9. Návrh, model, verzi promptu, jazyk, confidence a použitý fakt uloží k leadu. Návrh se tímto krokem neposílá.
10. Operátor zkontroluje firmu, zdroj kontaktu, skóre, text a důvod oprávnění ke kontaktu.
11. Schválený lead se odešle do Quickly pouze tehdy, když projde všemi kontrolami způsobilosti.
12. Twenty uchovává idempotentně dohledanou nebo vytvořenou Company a návrh jako nativní Note. Quickly řídí e-mailovou kampaň, odesílací schránku, sekvence a reakce.

První nastavení discovery
1. ARES nevyžaduje API key a zůstává aktivní vždy. Pro známé obory bot mapuje běžný text na kategorii; přesný ARES filtr lze zadat jako nace:95310. Neznámý text ARES hledá v obchodním názvu.
2. V Geoapify vytvoř bezplatný API key a na VPS nastav GEOAPIFY_API_KEY v tajném sales-bot.env. Geoapify je primární zdroj provozoven a kontaktů. Klíč neposílej do Telegramu ani do repozitáře.
3. Volitelně nastav GOOGLE_PLACES_API_KEY. Google se použije pouze jako fallback pro chybějící kontaktní výsledky; bez klíče bot normálně funguje přes ARES a Geoapify. Potom znovu nasaď nebo restartuj sales-bot.
4. Existující UUID vypíše /sales_campaigns. Novou kampaň vytvoř z VPS přes Sales API:
curl -X POST http://127.0.0.1:4050/v1/campaigns -H "Authorization: Bearer $SALES_API_TOKEN" -H "Content-Type: application/json" --data '{"name":"Brno autoservisy","offer":"modernizace webu","subjectTemplate":"Nápad pro {{company}}","bodyTemplate":"Dobrý den, {{observation}} Nabízíme {{offer}}."}'
Kampaň může zůstat disabled pro čistý research; enabled ovládá odesílání, ne analýzu.
5. Pro okamžitý výpis bez kampaně spusť /sales_search autoservis | Brno | 15. Výsledek se nikam neukládá. Horské chaty jsou mapované na Geoapify kategorie accommodation.hut + accommodation.chalet a CZ-NACE 55200, takže funguje například /sales_search horské chaty | Moravskoslezský kraj | 15. Pro přesný obor lze použít /sales_search nace:95310 | Brno | 15 nebo Geoapify kategorii ve tvaru geo:service.vehicle.repair.car.
6. Pro import spusť /sales_find <campaign-id> | autoservis | Brno | 15, potom /sales_run a /sales_calls 20. Detail a původ každého uloženého kontaktu ověříš přes /sales_lead <id>.

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
    command: 'sales_search',
    description: 'Jednorázově hledat firmy bez kampaně',
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
] as const;

const send = async (ctx: Context, message: string) => {
  for (const part of splitTelegramMessage(message, 3900)) {
    await ctx.reply(part);
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
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedUserIds));
  bot.command(['start', 'help', 'sales_help'], (ctx) => send(ctx, salesHelp));
  bot.command(['about', 'sales_about'], (ctx) => send(ctx, salesAbout));
  bot.command('sales_status', async (ctx) => {
    const campaigns = await store.listCampaigns();
    const leads = await store.listLeads(undefined, 100);
    await ctx.reply(
      `Campaigns: ${campaigns.length}; recent leads: ${leads.length}; qualified: ${leads.filter((lead) => lead.stage === 'QUALIFIED').length}; Quickly enrolled: ${leads.filter((lead) => lead.stage === 'SYNCED_TO_QUICKLY').length}; Discovery: ARES active, Geoapify ${service.geoapifyConfigured ? 'configured' : 'missing GEOAPIFY_API_KEY'}, Google fallback ${service.googlePlacesConfigured ? 'configured' : 'disabled'}.`,
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
  bot.command('sales_search', async (ctx) => {
    const input = parseSalesSearch(ctx.match);
    if (!input) {
      await ctx.reply(
        'Použití: /sales_search <obor/služba> | <lokalita> | <limit 1–20>\nPříklad: /sales_search autoservis | Brno | 15',
      );
      return;
    }
    try {
      await ctx.reply(
        'Hledám firmy v ARES a Geoapify; Google použiji jen jako nakonfigurovaný fallback…',
      );
      const companies = await service.searchBusinesses(input);
      await send(
        ctx,
        companies.length
          ? `🔎 Výsledky (${companies.length}) pro „${input.query}“ · ${input.locality}\nVýsledky se neuložily do kampaně ani CRM. Veřejný kontakt sám nezakládá oprávnění firmu oslovit. Geoapify výsledky obsahují data © OpenStreetMap contributors.\n\n${companies
              .map(
                (company, index) =>
                  `${index + 1}. ${company.name}\nZdroj: ${company.provider}${company.registrationId && company.provider !== 'ARES' ? ' + ARES' : ''}\nIČO: ${company.registrationId ?? 'neuvedeno'}\nCZ-NACE: ${company.naceCodes?.join(', ') ?? 'neuvedeno'}\nTelefon: ${company.phone ?? 'neuveden'}\nE-mail: ${company.email ?? 'neuveden'}\nAdresa: ${company.address ?? 'neuvedena'}\nWeb: ${company.websiteUrl ?? 'neuveden'}\nDetail zdroje: ${company.sourceUrl}`,
              )
              .join('\n\n')}`
          : `Pro „${input.query}“ v lokalitě ${input.locality} nebyly nalezeny žádné firmy. Zkontroluj /sales_status a logy „Sales discovery source completed“. Pro nepodporovaný obor použij přesnou kategorii, například /sales_search geo:accommodation.hut | ${input.locality} | ${input.limit}.`,
      );
    } catch (error) {
      await ctx.reply(
        `Hledání selhalo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    const id = ctx.match.trim();
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
