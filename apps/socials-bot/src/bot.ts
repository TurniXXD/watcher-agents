import { assertPublicHttpUrl } from '@watcher/core';
import type { SocialsStore, SocialTrendStore } from '@watcher/database';
import {
  authorizationMiddleware,
  splitTelegramMessage,
} from '@watcher/telegram';
import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import { z } from 'zod';
import type { SocialsService } from './service.js';
import type { SocialTranscriber } from './transcription.js';
import {
  dateInTimezone,
  formatPragueDateTime,
  nextPlanningWeek,
} from './time.js';
import { socialEventSources } from './source-registry.js';
import { contentConceptSchema } from './trends/content-agent.js';
import { parseTrendImport } from './trends/import.js';
import type { SocialTrendIntelligence } from './trends/runner.js';
import { trendSourceIdSchema, type TrendSourceId } from './trends/types.js';

const helpText = `📣 Socials Bot

Databáze je zdroj pravdy, Telegram je ovládání a Notion redakční prostor. Bot nic automaticky nepublikuje.

/socials — hlavní menu
/socials_plan — nedělní plánování
/socials_ideas — zásobník nápadů
/socials_add [nápad] — uložit nápad
/socials_projects — projekty
/socials_topics — témata
/socials_week — redakční kalendář a checklist
/socials_pack — Sunday Content Pack pro ChatGPT
/socials_drafts — rozpracované návrhy
/socials_status — stav výroby nebo ruční změna stavu
/socials_history — publikovaná historie
/socials_analytics — ručně zaznamenané výsledky
/socials_networking — doporučené akce a účast
/socials_events — nadcházející akce
/socials_events_free — bezplatné akce
/socials_events_week — akce pro příští týden
/socials_event_add — ruční přidání ověřitelné akce
/socials_sources — registry zdrojů a jejich skutečný stav
/socials_contacts — kontakty a schválené follow-upy
/socials_trends — Trend Intelligence přehled nebo denní report
/socials_trends run [YOUTUBE,REDDIT] — ruční výzkumný běh
/socials_trend ID — evidence, skóre a české obsahové návrhy
/socials_trend_use ID — přidat příležitost do zásobníku nápadů
/socials_trend_feedback ID relevant|not_relevant|saturated|good|published|leads
/socials_trend_import — ruční CSV/JSON import pro TikTok, Instagram a Google Trends
/socials_trend_settings — zdroje, klíčová slova a denní plán
/socials_help — tato nápověda

Uložení draftu: /socials_drafts a vyber položku. Publikaci potvrď ručně:
/socials_status ID PUBLISHED https://...

Projekt lze přidat:
/socials_projects add Název | popis | PUBLIC/PRIVATE`;

const mainKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text('🚀 Naplánovat týden', 'social:plan')
    .text('💡 Zásobník nápadů', 'social:ideas')
    .row()
    .text('📊 Historie a výsledky', 'social:history')
    .text('🤝 Networking', 'social:networking')
    .row()
    .text('📦 Content Pack', 'social:pack')
    .text('📅 Tento týden', 'social:week')
    .row()
    .text('🔭 Trend Intelligence', 'social:trends');

const commandArgument = (ctx: Context): string =>
  typeof ctx.match === 'string' ? ctx.match.trim() : '';

const replyLong = async (ctx: Context, text: string): Promise<void> => {
  for (const part of splitTelegramMessage(text)) {
    await ctx.reply(part, { link_preview_options: { is_disabled: true } });
  }
};

const planningQuestions = [
  ['workedOn', '1/6 Na čem jsi tento týden pracoval?'],
  ['discovered', '2/6 Co zajímavého jsi vytvořil nebo zjistil?'],
  ['problem', '3/6 Jaký problém jsi řešil?'],
  ['promotedService', '4/6 Jakou službu chceš příští týden propagovat?'],
  [
    'assets',
    '5/6 Máš screenshoty, videa nebo fotografie? Napiš co máš, nebo „ne“.',
  ],
  ['preparationMinutes', '6/6 Kolik minut chceš dnes přípravě věnovat?'],
] as const;

const planningPayloadSchema = z.object({
  index: z.number().int().min(0).max(planningQuestions.length),
  answers: z.record(z.string(), z.string()),
});

const importPayloadSchema = z.object({ contentItemId: z.string().uuid() });
const editPayloadSchema = z.object({ contentItemId: z.string().uuid() });
const debriefPayloadSchema = z.object({
  attendanceId: z.string().uuid(),
  index: z.number().int().min(0).max(3),
  answers: z.record(z.string(), z.string()),
});
const trendFeedbackSchema = z.enum([
  'RELEVANT',
  'NOT_RELEVANT',
  'ALREADY_SATURATED',
  'GOOD_IDEA',
  'PUBLISHED',
  'GENERATED_LEADS',
]);
const debriefQuestions = [
  ['highlights', 'Co bylo na akci nejzajímavější?'],
  ['lessons', 'Co konkrétního sis odnesl nebo naučil?'],
  ['notes', 'S kým nebo o čem jsi mluvil? Neuváděj citlivé údaje bez důvodu.'],
] as const;

type SocialBotDependencies = {
  token: string;
  allowedIds: ReadonlySet<number>;
  store: SocialsStore;
  service: SocialsService;
  trendStore: SocialTrendStore;
  trendIntelligence: SocialTrendIntelligence;
  defaultTrendSources: readonly TrendSourceId[];
  timezone: string;
  transcriber?: SocialTranscriber;
  download?: (fileId: string) => Promise<Uint8Array>;
  reportError: (error: unknown) => void;
};

const renderTrendOverview = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
): Promise<void> => {
  if (!ctx.from) return;
  const ownerUserId = BigInt(ctx.from.id);
  const profile =
    await dependencies.trendIntelligence.ensureProfile(ownerUserId);
  const report = await dependencies.trendStore.latestReport(ownerUserId);
  const availability = dependencies.trendIntelligence
    .sourceAvailability()
    .map(
      (source) =>
        `• ${source.id}: ${source.enabled ? 'připraven' : 'nenakonfigurován / jen ruční import'} — ${source.name}`,
    )
    .join('\n');
  await replyLong(
    ctx,
    `🔭 Trend Intelligence\nStav: ${profile.enabled ? 'zapnuto' : 'vypnuto'}\nPlán: ${profile.schedule} (${profile.timezone})\nDalší běh: ${profile.nextRunAt?.toISOString() ?? 'nenaplánován'}\nPoslední běh: ${profile.lastRunAt?.toISOString() ?? 'zatím žádný'}\n\nDostupnost zdrojů:\n${availability}\n\n${report?.text ?? 'Zatím není žádný report. Spusť /socials_trends run.'}`,
  );
  const opportunities = report?.run.opportunities ?? [];
  for (const opportunity of opportunities.slice(0, 5)) {
    await ctx.reply(
      `${opportunity.opportunityScore}/100 · jistota ${opportunity.confidence}/100\n${opportunity.title}\nID: ${opportunity.id}`,
      {
        reply_markup: new InlineKeyboard()
          .text('🔎 Detail', `social:trend:${opportunity.id}`)
          .text('💡 Do zásobníku', `social:trenduse:${opportunity.id}`)
          .row()
          .text('👍 Relevantní', `social:tf:R:${opportunity.id}`)
          .text('👎 Nerelevantní', `social:tf:N:${opportunity.id}`),
      },
    );
  }
};

const renderTrendDetail = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
  opportunityId: string,
): Promise<void> => {
  if (!ctx.from) return;
  const opportunity = await dependencies.trendStore.opportunity(
    BigInt(ctx.from.id),
    opportunityId,
  );
  if (!opportunity) {
    await ctx.reply('Trendová příležitost nebyla nalezena.');
    return;
  }
  const concept = contentConceptSchema.parse(opportunity.contentConcept);
  const comparison = opportunity.cluster.comparisons[0];
  const sourceLines = opportunity.cluster.signals
    .slice(0, 10)
    .map(
      (signal) =>
        `• ${signal.source}/${signal.region}: ${signal.title}\n  ${signal.sourceUrl}`,
    )
    .join('\n');
  const carousel = concept.carousel
    .map(
      (slide, index) =>
        `${index + 1}. ${slide.title}\n${slide.content}\nVizuál: ${slide.visual}`,
    )
    .join('\n\n');
  await replyLong(
    ctx,
    `🔭 ${opportunity.title}\nSkóre ${opportunity.opportunityScore}/100 · jistota ${opportunity.confidence}/100\nČeský status: ${opportunity.czechMarketStatus}\nFormát: ${opportunity.recommendedChannel}/${opportunity.recommendedFormat}\nCíl: ${opportunity.objective} · ${opportunity.estimatedEffortMinutes} min\n\nFAKTA A PROVENIENCE\n${sourceLines || 'Žádné zdrojové odkazy'}\n\nODHAD A NEJISTOTA\n${comparison?.explanation ?? opportunity.explanation}\nChybí: ${opportunity.missingData.join(', ') || 'žádná zásadní data'}\n\nPROČ TO ŘEŠIT\n${concept.research.whyTrending}\n${concept.research.businessRelevance}\n\nHOOKY\n1. ${concept.hooks.curiosity}\n2. ${concept.hooks.problem}\n3. ${concept.hooks.practical}\n\nVIDEO 30–60 s\n${concept.shortVideo.opening}\n${concept.shortVideo.explanation}\nPříklad: ${concept.shortVideo.example}\nPointa: ${concept.shortVideo.takeaway}\nCTA: ${concept.shortVideo.cta}\n\nLINKEDIN\n${concept.linkedInPost}\n\nCAROUSEL\n${carousel}\n\nPRODUKCE\nScreenshoty: ${concept.suggestedScreenshots.join('; ') || 'nejsou nutné'}\nOvěřit: ${concept.claimsToVerify.join('; ') || 'běžná redakční kontrola'}\n${concept.originalityNote}\n\nID: ${opportunity.id}`,
  );
  await ctx.reply('Akce s příležitostí:', {
    reply_markup: new InlineKeyboard()
      .text('💡 Přidat do zásobníku', `social:trenduse:${opportunity.id}`)
      .row()
      .text('👍 Relevantní', `social:tf:R:${opportunity.id}`)
      .text('💚 Dobrý nápad', `social:tf:G:${opportunity.id}`)
      .row()
      .text('📈 Nasycené', `social:tf:S:${opportunity.id}`)
      .text('👎 Nerelevantní', `social:tf:N:${opportunity.id}`),
  });
};

const renderIdeas = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
): Promise<void> => {
  if (!ctx.from) return;
  const ideas = await dependencies.store.listIdeas(BigInt(ctx.from.id));
  if (!ideas.length) {
    await ctx.reply(
      'Zásobník je prázdný. Přidej první nápad přes /socials_add text.',
    );
    return;
  }
  await replyLong(
    ctx,
    `💡 Zásobník nápadů\n\n${ideas
      .slice(0, 30)
      .map(
        (idea) =>
          `• ${idea.title}\n  ${idea.status} · ${idea.priority} · ${idea.topics.map(({ topic }) => topic.name).join(', ') || 'bez tématu'}\n  ID: ${idea.id}`,
      )
      .join('\n\n')}`,
  );
};

const renderPlan = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
): Promise<void> => {
  if (!ctx.from) return;
  const week = nextPlanningWeek(new Date(), dependencies.timezone);
  const plan = await dependencies.store.findWeeklyPlan(
    BigInt(ctx.from.id),
    week.start,
  );
  if (!plan) {
    await ctx.reply('Pro příští týden ještě není plán. Spusť /socials_plan.');
    return;
  }
  const text = [
    `📅 Redakční plán od ${week.key} · ${plan.status}`,
    ...plan.contentItems.map(
      (item) =>
        `\n${formatPragueDateTime(item.plannedAt ?? item.createdAt, dependencies.timezone)} · ${item.channel}/${item.format}\n${item.title}\nÚhel: ${item.angle}\nProč: ${item.planningReason}${item.similarityWarning ? `\n⚠️ ${item.similarityWarning}` : ''}\nOdhad: ${item.estimatedPreparationMinutes} min · Stav: ${item.status}\nID: ${item.id}`,
    ),
    '\nChecklist:',
    ...plan.checklistItems.map(
      (item) => `${item.completed ? '✅' : '⬜'} ${item.title}`,
    ),
  ].join('\n');
  const keyboard = new InlineKeyboard();
  if (plan.status === 'DRAFT') {
    keyboard.text('✅ Schválit plán', `social:approve:${plan.id}`).row();
  }
  for (const item of plan.checklistItems.slice(0, 8)) {
    keyboard
      .text(
        `${item.completed ? '↩️' : '✅'} ${item.title.slice(0, 28)}`,
        `social:check:${item.id}`,
      )
      .row();
  }
  if (plan.status === 'DRAFT') {
    for (const item of plan.contentItems.slice(0, 8)) {
      keyboard
        .text(`✏️ ${item.title.slice(0, 18)}`, `social:edit:${item.id}`)
        .text('♻️ Prompt', `social:refresh:${item.id}`)
        .text('🗑️', `social:remove:${item.id}`)
        .row();
    }
  }
  await ctx.reply(text, { reply_markup: keyboard });
};

const renderEvents = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
  freeOnly = false,
): Promise<void> => {
  if (!ctx.from) return;
  const events = await dependencies.service.discoverEvents(
    BigInt(ctx.from.id),
    BigInt(ctx.chat!.id),
    { freeOnly },
  );
  if (!events.length) {
    await ctx.reply(
      'Nenašel jsem žádnou odpovídající a dostatečně doloženou akci. Nevymýšlím náhrady; přidej akci přes /socials_event_add.',
    );
    return;
  }
  for (const event of events) {
    const source = event.sourceReferences[0]?.officialUrl ?? event.canonicalUrl;
    const price =
      event.priceStatus === 'FREE'
        ? 'zdarma (doloženo zdrojem)'
        : event.priceStatus === 'PAID'
          ? `${event.priceAmount === null ? '?' : String(event.priceAmount)} ${event.currency ?? ''}`.trim()
          : 'cena neověřena';
    await ctx.reply(
      `🤝 ${event.title}\n${formatPragueDateTime(event.startAt, event.timezone)}\n${event.venue ?? event.city ?? 'místo neověřeno'} · ${price}\nProč: ${event.relevanceReasons.join('; ') || 'odpovídá vybraným kategoriím'}\nOvěření: ${event.verificationStatus}\n${source ?? ''}`,
      {
        reply_markup: new InlineKeyboard()
          .text('⭐ Mám zájem', `social:att:INTERESTED:${event.id}`)
          .text('✅ Přihlásil jsem se', `social:att:REGISTERED:${event.id}`)
          .row()
          .text('❌ Nezajímá mě', `social:att:CANCELLED:${event.id}`),
      },
    );
  }
};

const startPlanning = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const week = nextPlanningWeek(new Date(), dependencies.timezone);
  const existing = await dependencies.store.findWeeklyPlan(
    BigInt(ctx.from.id),
    week.start,
  );
  if (existing) {
    await renderPlan(ctx, dependencies);
    return;
  }
  await dependencies.store.startSession({
    ownerUserId: BigInt(ctx.from.id),
    chatId: BigInt(ctx.chat.id),
    sessionType: 'WEEKLY_PLANNING',
    state: 'QUESTION',
    payload: { index: 0, answers: {} },
    expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
  });
  await ctx.reply(planningQuestions[0][1]);
};

const handleSessionAnswer = async (
  ctx: Context,
  dependencies: SocialBotDependencies,
  text: string,
): Promise<boolean> => {
  if (!ctx.from || !ctx.chat) return false;
  const session = await dependencies.store.activeSession(
    BigInt(ctx.from.id),
    BigInt(ctx.chat.id),
  );
  if (!session) return false;
  if (session.sessionType === 'ADD_IDEA') {
    const result = await dependencies.service.captureIdea(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
      text,
    );
    await dependencies.store.endSession(session.id);
    await ctx.reply(
      result.created
        ? `✅ Nápad uložen: ${result.idea.title}${result.novelty.similar[0] ? `\n⚠️ ${result.novelty.similar[0].explanation}\nJiný úhel: ${result.novelty.similar[0].alternativeAngle}` : ''}`
        : `⚠️ Stejný nápad už existuje: ${result.idea.title}`,
    );
    return true;
  }
  if (session.sessionType === 'CONTENT_IMPORT') {
    const payload = importPayloadSchema.parse(session.payload);
    await dependencies.store.saveContentVersion({
      ownerUserId: BigInt(ctx.from.id),
      contentItemId: payload.contentItemId,
      content: text,
      source: 'IMPORTED',
      status: 'DRAFT',
    });
    await dependencies.store.endSession(session.id);
    await ctx.reply(
      '✅ Draft byl uložen jako nová verze. Starší verze zůstala zachovaná.',
    );
    return true;
  }
  if (session.sessionType === 'CONTENT_EDIT') {
    const payload = editPayloadSchema.parse(session.payload);
    const [title, angle, hook, cta] = text
      .split('|')
      .map((part) => part.trim());
    if (!title || !angle) {
      await ctx.reply(
        'Použij formát: Název | úhel | hook (volitelně) | CTA (volitelně)',
      );
      return true;
    }
    await dependencies.store.updateDraftContentItem(
      BigInt(ctx.from.id),
      payload.contentItemId,
      {
        title,
        angle,
        ...(hook ? { hook } : {}),
        ...(cta ? { cta } : {}),
      },
    );
    await dependencies.store.endSession(session.id);
    await ctx.reply('✅ Položka plánu byla upravena.');
    return true;
  }
  if (session.sessionType === 'EVENT_DEBRIEF') {
    const payload = debriefPayloadSchema.parse(session.payload);
    const question = debriefQuestions[payload.index];
    if (!question) return true;
    const answers = { ...payload.answers, [question[0]]: text };
    const nextIndex = payload.index + 1;
    if (nextIndex < debriefQuestions.length) {
      await dependencies.store.updateSession(session.id, 'QUESTION', {
        ...payload,
        index: nextIndex,
        answers,
      });
      await ctx.reply(debriefQuestions[nextIndex]![1]);
    } else {
      await dependencies.store.saveAttendanceDebrief({
        ownerUserId: BigInt(ctx.from.id),
        attendanceId: payload.attendanceId,
        ...(answers.notes ? { notes: answers.notes } : {}),
        ...(answers.highlights ? { highlights: answers.highlights } : {}),
        ...(answers.lessons ? { lessons: answers.lessons } : {}),
      });
      await dependencies.store.completeSession(session.id, {
        ...payload,
        index: nextIndex,
        answers,
      });
      await ctx.reply(
        '✅ Debrief uložen soukromě. Chceš-li z něj vytvořit nápad bez jmen kontaktů, použij tlačítko.',
        {
          reply_markup: new InlineKeyboard().text(
            '💡 Vytvořit nápad',
            `social:eventidea:${payload.attendanceId}`,
          ),
        },
      );
    }
    return true;
  }
  if (session.sessionType === 'TREND_IMPORT') {
    let signals: ReturnType<typeof parseTrendImport>;
    try {
      signals = parseTrendImport(text);
    } catch {
      await ctx.reply(
        'Import se nepodařilo ověřit. Zkontroluj CSV/JSON, povinná pole title a url a použij pouze veřejné HTTP(S) odkazy.',
      );
      return true;
    }
    if (!signals.length) {
      await ctx.reply('Import neobsahuje žádné platné řádky.');
      return true;
    }
    await dependencies.store.endSession(session.id);
    await ctx.reply(
      `🔭 Importuji ${signals.length} ověřitelných referencí a připravuji report…`,
    );
    const report = await dependencies.trendIntelligence.run({
      ownerUserId: BigInt(ctx.from.id),
      chatId: BigInt(ctx.chat.id),
      trigger: 'MANUAL',
      selectedSources: [],
      seedSignals: signals,
    });
    await replyLong(
      ctx,
      report?.text ??
        'Import byl uložen, ale nevznikla žádná dostatečně doložená příležitost.',
    );
    return true;
  }
  if (session.sessionType !== 'WEEKLY_PLANNING') return false;
  const payload = planningPayloadSchema.parse(session.payload);
  const question = planningQuestions[payload.index];
  if (!question) return true;
  const answers = { ...payload.answers, [question[0]]: text };
  const nextIndex = payload.index + 1;
  if (nextIndex < planningQuestions.length) {
    await dependencies.store.updateSession(session.id, 'QUESTION', {
      index: nextIndex,
      answers,
    });
    await ctx.reply(planningQuestions[nextIndex]![1]);
    return true;
  }
  const minutes = Math.min(
    720,
    Math.max(0, Number.parseInt(answers.preparationMinutes ?? '0', 10) || 0),
  );
  await ctx.reply('🧭 Sestavuji plán, kontroluji duplicity a pracovní zátěž…');
  const plan = await dependencies.service.planWeek({
    ownerUserId: BigInt(ctx.from.id),
    chatId: BigInt(ctx.chat.id),
    planningSessionId: session.id,
    answers: {
      workedOn: answers.workedOn ?? '',
      discovered: answers.discovered ?? '',
      problem: answers.problem ?? '',
      promotedService: answers.promotedService ?? '',
      assets: answers.assets ?? '',
      preparationMinutes: minutes,
    },
  });
  await dependencies.store.completeSession(session.id, {
    index: nextIndex,
    answers,
    weeklyPlanId: plan.id,
  });
  await renderPlan(ctx, dependencies);
  return true;
};

export const createSocialsBot = (dependencies: SocialBotDependencies): Bot => {
  const bot = new Bot(dependencies.token);
  bot.use(authorizationMiddleware(dependencies.allowedIds));
  bot.command(['start', 'socials'], async (ctx) => {
    if (ctx.from && ctx.chat) {
      await dependencies.store.ensureSettings(
        BigInt(ctx.from.id),
        BigInt(ctx.chat.id),
      );
    }
    await ctx.reply('📣 Socials Bot — co chceš udělat?', {
      reply_markup: mainKeyboard(),
    });
  });
  bot.command('socials_help', async (ctx) => replyLong(ctx, helpText));
  bot.command('socials_trends', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    await dependencies.store.ensureSettings(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
    );
    const argument = commandArgument(ctx);
    if (!argument.toLocaleLowerCase('en-US').startsWith('run')) {
      await renderTrendOverview(ctx, dependencies);
      return;
    }
    const requested = argument
      .slice(3)
      .trim()
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    let selected: TrendSourceId[];
    if (requested.length) {
      const parsedSources = z.array(trendSourceIdSchema).safeParse(requested);
      if (!parsedSources.success) {
        await ctx.reply(
          'Neznámý zdroj. Použij YOUTUBE, REDDIT, GOOGLE_TRENDS, TIKTOK, INSTAGRAM nebo MANUAL.',
        );
        return;
      }
      selected = parsedSources.data;
    } else {
      selected = [...dependencies.defaultTrendSources];
    }
    await ctx.reply(
      `🔭 Spouštím výzkum: ${selected.join(', ') || 'žádné automatické zdroje'}… Jednotlivé zdroje se zpracují nezávisle.`,
    );
    const report = await dependencies.trendIntelligence.run({
      ownerUserId: BigInt(ctx.from.id),
      chatId: BigInt(ctx.chat.id),
      trigger: 'MANUAL',
      selectedSources: selected,
    });
    await replyLong(
      ctx,
      report?.text ?? 'Výzkum neskončil použitelným reportem.',
    );
  });
  bot.command('socials_trend', async (ctx) => {
    const id = commandArgument(ctx);
    if (!id) {
      await ctx.reply('Použití: /socials_trend OPPORTUNITY_ID');
      return;
    }
    await renderTrendDetail(ctx, dependencies, id);
  });
  bot.command('socials_trend_use', async (ctx) => {
    if (!ctx.from) return;
    const id = commandArgument(ctx);
    if (!id) {
      await ctx.reply('Použití: /socials_trend_use OPPORTUNITY_ID');
      return;
    }
    const idea = await dependencies.trendStore.convertOpportunityToIdea(
      BigInt(ctx.from.id),
      id,
    );
    await ctx.reply(
      `✅ Příležitost je v zásobníku nápadů: ${idea.title}\nID: ${idea.id}`,
    );
  });
  bot.command('socials_trend_feedback', async (ctx) => {
    if (!ctx.from) return;
    const [opportunityId, rawKind, ...notes] =
      commandArgument(ctx).split(/\s+/u);
    const feedbackKinds: Record<string, z.infer<typeof trendFeedbackSchema>> = {
      relevant: 'RELEVANT',
      not_relevant: 'NOT_RELEVANT',
      saturated: 'ALREADY_SATURATED',
      good: 'GOOD_IDEA',
      published: 'PUBLISHED',
      leads: 'GENERATED_LEADS',
    };
    const kind = rawKind
      ? feedbackKinds[rawKind.toLocaleLowerCase('en-US')]
      : undefined;
    const parsedKind = trendFeedbackSchema.safeParse(kind);
    if (!opportunityId || !parsedKind.success) {
      await ctx.reply(
        'Použití: /socials_trend_feedback ID relevant|not_relevant|saturated|good|published|leads [poznámka]',
      );
      return;
    }
    await dependencies.trendStore.addFeedback({
      ownerUserId: BigInt(ctx.from.id),
      opportunityId,
      kind: parsedKind.data,
      ...(notes.length ? { notes: notes.join(' ') } : {}),
    });
    await ctx.reply(
      '✅ Feedback uložen. Budoucí pořadí ho použije jako malou transparentní korekci, ne jako důkaz kauzality.',
    );
  });
  bot.command('socials_trend_import', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    await dependencies.store.startSession({
      ownerUserId: BigInt(ctx.from.id),
      chatId: BigInt(ctx.chat.id),
      sessionType: 'TREND_IMPORT',
      state: 'WAITING_FOR_FILE',
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
    await ctx.reply(
      'Pošli CSV nebo JSON do 1 MB. Povinné sloupce: title,url. Volitelné: source,id,description,region,publishedAt,views,likes,comments,shares,searchInterest. Povolené ruční zdroje: GOOGLE_TRENDS, TIKTOK, INSTAGRAM, MANUAL.',
    );
  });
  bot.command('socials_trend_settings', async (ctx) => {
    if (!ctx.from) return;
    const ownerUserId = BigInt(ctx.from.id);
    const profile =
      await dependencies.trendIntelligence.ensureProfile(ownerUserId);
    const argument = commandArgument(ctx);
    if (!argument) {
      await ctx.reply(
        `🔭 Nastavení trendů\nStav: ${profile.enabled ? 'on' : 'off'}\nPlán: ${profile.schedule} | ${profile.timezone}\nZdroje: ${profile.enabledSources.join(', ')}\nReport: ${profile.reportSize}\nKeywords: ${profile.keywords.join(', ')}\nSubreddits: ${profile.subreddits.join(', ')}\n\nZměny:\n/socials_trend_settings on|off\n/socials_trend_settings sources YOUTUBE,REDDIT\n/socials_trend_settings schedule 0 7 * * * | Europe/Prague\n/socials_trend_settings report 5\n/socials_trend_settings keywords AI automation,local LLM\n/socials_trend_settings subreddits artificial,LocalLLaMA`,
      );
      return;
    }
    const lower = argument.toLocaleLowerCase('en-US');
    if (lower === 'on' || lower === 'off') {
      await dependencies.trendStore.updateProfile(ownerUserId, {
        enabled: lower === 'on',
      });
    } else if (lower.startsWith('sources ')) {
      const values = argument
        .slice(8)
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const parsedSources = z.array(trendSourceIdSchema).safeParse(values);
      if (!parsedSources.success) {
        await ctx.reply(
          'Neznámý zdroj. Použij YOUTUBE, REDDIT, GOOGLE_TRENDS, TIKTOK, INSTAGRAM nebo MANUAL.',
        );
        return;
      }
      await dependencies.trendStore.updateProfile(ownerUserId, {
        enabledSources: parsedSources.data,
      });
    } else if (lower.startsWith('schedule ')) {
      const [schedule, timezone] = argument
        .slice(9)
        .split('|')
        .map((value) => value.trim());
      if (!schedule || !timezone) {
        await ctx.reply(
          'Použití: /socials_trend_settings schedule 0 7 * * * | Europe/Prague',
        );
        return;
      }
      await dependencies.trendStore.updateProfile(ownerUserId, {
        schedule,
        timezone,
      });
    } else if (lower.startsWith('report ')) {
      const reportSize = Number.parseInt(argument.slice(7).trim(), 10);
      if (!Number.isInteger(reportSize) || reportSize < 1 || reportSize > 10) {
        await ctx.reply('Velikost reportu musí být 1 až 10.');
        return;
      }
      await dependencies.trendStore.updateProfile(ownerUserId, { reportSize });
    } else if (lower.startsWith('keywords ')) {
      const keywords = argument
        .slice(9)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 30);
      await dependencies.trendStore.updateProfile(ownerUserId, { keywords });
    } else if (lower.startsWith('subreddits ')) {
      const subreddits = argument
        .slice(11)
        .split(',')
        .map((value) => value.trim().replace(/^r\//u, ''))
        .filter((value) => /^[A-Za-z0-9_]{2,50}$/u.test(value))
        .slice(0, 30);
      await dependencies.trendStore.updateProfile(ownerUserId, { subreddits });
    } else {
      await ctx.reply('Neznámé nastavení. Použij /socials_trend_settings.');
      return;
    }
    await ctx.reply('✅ Nastavení Trend Intelligence bylo uloženo.');
  });
  bot.command('socials_add', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const note = commandArgument(ctx);
    if (!note) {
      await dependencies.store.startSession({
        ownerUserId: BigInt(ctx.from.id),
        chatId: BigInt(ctx.chat.id),
        sessionType: 'ADD_IDEA',
        state: 'WAITING_FOR_TEXT',
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
      await ctx.reply('Pošli text nebo hlasovou poznámku s nápadem.');
      return;
    }
    const result = await dependencies.service.captureIdea(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
      note,
    );
    await ctx.reply(
      result.created
        ? `✅ Nápad uložen: ${result.idea.title}${result.novelty.similar[0] ? `\n⚠️ ${result.novelty.similar[0].explanation}\nJiný úhel: ${result.novelty.similar[0].alternativeAngle}` : ''}`
        : `⚠️ Stejný nápad už existuje: ${result.idea.title}`,
    );
  });
  bot.command('socials_ideas', (ctx) => renderIdeas(ctx, dependencies));
  bot.command('socials_topics', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    await dependencies.store.ensureSettings(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
    );
    const topics = await dependencies.store.listTopics(BigInt(ctx.from.id));
    await ctx.reply(
      `🏷 Témata\n${topics.map((topic) => `• ${topic.name} — ${topic.pillar}`).join('\n')}`,
    );
  });
  bot.command('socials_projects', async (ctx) => {
    if (!ctx.from) return;
    const argument = commandArgument(ctx);
    if (argument.toLocaleLowerCase('cs-CZ').startsWith('add ')) {
      const [name, description, visibility] = argument
        .slice(4)
        .split('|')
        .map((part) => part.trim());
      if (!name) {
        await ctx.reply(
          'Použití: /socials_projects add Název | popis | PUBLIC/PRIVATE',
        );
        return;
      }
      const project = await dependencies.store.createProject({
        ownerUserId: BigInt(ctx.from.id),
        name,
        ...(description ? { description } : {}),
        visibility:
          visibility?.toUpperCase() === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
      });
      await ctx.reply(
        `✅ Projekt uložen: ${project.name} (${project.visibility})`,
      );
      return;
    }
    const projects = await dependencies.store.listProjects(BigInt(ctx.from.id));
    await ctx.reply(
      projects.length
        ? `🧩 Projekty\n${projects.map((project) => `• ${project.name} · ${project.status} · ${project.visibility}`).join('\n')}`
        : 'Zatím nejsou žádné projekty. Přidej: /socials_projects add Název | popis | PRIVATE',
    );
  });
  bot.command('socials_plan', (ctx) => startPlanning(ctx, dependencies));
  bot.command('socials_week', (ctx) => renderPlan(ctx, dependencies));
  bot.command('socials_pack', async (ctx) => {
    if (!ctx.from) return;
    const result = await dependencies.service.contentPack(BigInt(ctx.from.id));
    if (!result) {
      await ctx.reply('Nejdřív vytvoř plán přes /socials_plan.');
      return;
    }
    await ctx.replyWithDocument(
      new InputFile(
        new TextEncoder().encode(result.pack.markdown),
        `socials-content-pack-v${result.pack.version}.md`,
      ),
      { caption: `📦 Sunday Content Pack v${result.pack.version}` },
    );
  });
  bot.command('socials_drafts', async (ctx) => {
    if (!ctx.from) return;
    const items = await dependencies.store.listContent(BigInt(ctx.from.id), {
      statuses: ['PLANNED', 'PROMPT_READY', 'DRAFT', 'READY'],
      limit: 30,
    });
    if (!items.length) {
      await ctx.reply('Nejsou žádné rozpracované položky.');
      return;
    }
    for (const item of items) {
      await ctx.reply(
        `${item.title}\n${item.channel}/${item.format} · ${item.status}\nID: ${item.id}`,
        {
          reply_markup: new InlineKeyboard().text(
            '📝 Vložit novou verzi',
            `social:import:${item.id}`,
          ),
        },
      );
    }
  });
  bot.command('socials_status', async (ctx) => {
    if (!ctx.from) return;
    const argument = commandArgument(ctx);
    if (!argument) {
      const items = await dependencies.store.listContent(BigInt(ctx.from.id), {
        limit: 40,
      });
      await replyLong(
        ctx,
        `🛠 Stav výroby\n${items.map((item) => `• ${item.status} · ${item.channel} · ${item.title}\n  ${item.id}`).join('\n') || 'Bez položek.'}`,
      );
      return;
    }
    const [id, rawStatus, url] = argument.split(/\s+/u);
    const statusSchema = z.enum([
      'IDEA',
      'PLANNED',
      'PROMPT_READY',
      'DRAFT',
      'READY',
      'SCHEDULED',
      'PUBLISHED',
      'SKIPPED',
      'ARCHIVED',
    ]);
    const parsed = statusSchema.safeParse(rawStatus?.toUpperCase());
    if (!id || !parsed.success) {
      await ctx.reply(
        'Použití: /socials_status ID READY nebo /socials_status ID PUBLISHED https://...',
      );
      return;
    }
    if (parsed.data === 'PUBLISHED' && !url) {
      await ctx.reply(
        'Publikovaný obsah vyžaduje skutečnou veřejnou URL: /socials_status ID PUBLISHED https://...',
      );
      return;
    }
    const publishedUrl =
      parsed.data === 'PUBLISHED' && url
        ? assertPublicHttpUrl(url).toString()
        : undefined;
    await dependencies.store.updateContentStatus({
      ownerUserId: BigInt(ctx.from.id),
      contentItemId: id,
      status: parsed.data,
      ...(parsed.data === 'SCHEDULED' ? { scheduledAt: new Date() } : {}),
      ...(parsed.data === 'PUBLISHED'
        ? { publishedAt: new Date(), publishedUrl: publishedUrl! }
        : {}),
    });
    await ctx.reply(`✅ Stav změněn na ${parsed.data}.`);
  });
  bot.command('socials_history', async (ctx) => {
    if (!ctx.from) return;
    const items = await dependencies.store.listContent(BigInt(ctx.from.id), {
      statuses: ['PUBLISHED'],
      limit: 50,
    });
    await replyLong(
      ctx,
      `📚 Publikovaná historie\n${items.map((item) => `• ${item.publishedAt?.toLocaleDateString('cs-CZ') ?? '?'} · ${item.channel} · ${item.title}\n  ${item.publishedUrl ?? 'URL nezadaná'}`).join('\n') || 'Zatím nic ručně potvrzeného jako publikované.'}`,
    );
  });
  bot.command('socials_analytics', async (ctx) => {
    if (!ctx.from) return;
    const argument = commandArgument(ctx);
    if (argument.toLowerCase().startsWith('add ')) {
      const [contentItemId, impressions, likes, comments, qualifiedLeads] =
        argument
          .slice(4)
          .split('|')
          .map((part) => part.trim());
      if (!contentItemId) {
        await ctx.reply(
          'Použití: /socials_analytics add ID | impressions | likes | comments | qualified leads',
        );
        return;
      }
      const number = (value: string | undefined): number | undefined => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
      };
      await dependencies.store.recordMetrics({
        ownerUserId: BigInt(ctx.from.id),
        contentItemId,
        metrics: {
          ...(number(impressions) === undefined
            ? {}
            : { impressions: number(impressions)! }),
          ...(number(likes) === undefined ? {} : { likes: number(likes)! }),
          ...(number(comments) === undefined
            ? {}
            : { comments: number(comments)! }),
          ...(number(qualifiedLeads) === undefined
            ? {}
            : { qualifiedLeads: number(qualifiedLeads)! }),
        },
      });
      await ctx.reply('✅ Metriky uloženy bez doplňování chybějících hodnot.');
      return;
    }
    const analytics = await dependencies.service.analytics(BigInt(ctx.from.id));
    await ctx.reply(
      `📊 Obsahová analytika\nPublikováno: ${analytics.published}\n${analytics.topics.map(([topic, values]) => `• ${topic}: ${values.published} položek, engagement ${values.engagement}, kvalifikované leady ${values.leads}`).join('\n') || 'Zatím nejsou ručně zadané výsledky.'}\n\n${analytics.caveat}`,
    );
  });
  bot.command(['socials_events', 'socials_events_week'], (ctx) =>
    renderEvents(ctx, dependencies),
  );
  bot.command('socials_networking', async (ctx) => {
    if (!ctx.from) return;
    const argument = commandArgument(ctx);
    if (argument.toLowerCase().startsWith('prefs ')) {
      if (!ctx.chat) return;
      const values: Record<string, string> = {};
      for (const part of argument.slice(6).split(';')) {
        const separator = part.indexOf('=');
        if (separator <= 0) continue;
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (key && value) values[key] = value;
      }
      const settings = await dependencies.store.ensureSettings(
        BigInt(ctx.from.id),
        BigInt(ctx.chat.id),
      );
      const positiveInteger = (
        value: string | undefined,
        fallback: number,
      ): number => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
      };
      const updated = await dependencies.store.updateSettings(
        BigInt(ctx.from.id),
        {
          ...(values.cities
            ? {
                preferredCities: values.cities
                  .split(',')
                  .map((city: string) => city.trim())
                  .filter(Boolean),
              }
            : {}),
          travelRadiusKm: positiveInteger(
            values.radius,
            settings.travelRadiusKm,
          ),
          maximumEventPriceCzk: positiveInteger(
            values.max,
            settings.maximumEventPriceCzk,
          ),
          weeklyRecommendationCount: Math.min(
            20,
            Math.max(
              1,
              positiveInteger(values.count, settings.weeklyRecommendationCount),
            ),
          ),
          mondayNetworkingReminder:
            values.monday === undefined
              ? settings.mondayNetworkingReminder
              : values.monday.toLowerCase() !== 'off',
        },
      );
      await ctx.reply(
        `✅ Preference uloženy: ${updated.preferredCities.join(', ')}, rádius ${updated.travelRadiusKm} km, preferovaná maximální cena ${updated.maximumEventPriceCzk} Kč, ${updated.weeklyRecommendationCount} doporučení, pondělní připomínka ${updated.mondayNetworkingReminder ? 'zapnuta' : 'vypnuta'}.\n\nPoužití: /socials_networking prefs cities=Brno,Ostrava; radius=80; max=0; count=5; monday=on`,
      );
      return;
    }
    const attendances = await dependencies.store.listAttendances(
      BigInt(ctx.from.id),
    );
    for (const attendance of attendances.slice(0, 10)) {
      const keyboard = new InlineKeyboard();
      if (
        ['INTERESTED', 'REGISTERED'].includes(attendance.status) &&
        attendance.event.startAt.getTime() <= Date.now()
      ) {
        keyboard.text(
          '✅ Opravdu jsem se zúčastnil',
          `social:attended:${attendance.id}`,
        );
      }
      await ctx.reply(
        `${attendance.event.title}\n${formatPragueDateTime(attendance.event.startAt, attendance.event.timezone)} · ${attendance.status}\nAttendance ID: ${attendance.id}`,
        keyboard.inline_keyboard.length ? { reply_markup: keyboard } : {},
      );
    }
    await renderEvents(ctx, dependencies);
  });
  bot.command('socials_events_free', (ctx) =>
    renderEvents(ctx, dependencies, true),
  );
  bot.command('socials_event_add', async (ctx) => {
    if (!ctx.from) return;
    const [title, dateTime, city, sourceUrl, price] = commandArgument(ctx)
      .split('|')
      .map((part) => part.trim());
    const dateMatch = dateTime?.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/u,
    );
    if (!title || !dateMatch || !sourceUrl) {
      await ctx.reply(
        'Použití: /socials_event_add Název | 2026-10-20 18:00 | Brno | https://oficialni-url | free/paid/unknown',
      );
      return;
    }
    const event = await dependencies.service.addManualEvent({
      ownerUserId: BigInt(ctx.from.id),
      title,
      startAt: dateInTimezone(
        {
          year: Number(dateMatch[1]),
          month: Number(dateMatch[2]),
          day: Number(dateMatch[3]),
          hour: Number(dateMatch[4]),
          minute: Number(dateMatch[5]),
        },
        dependencies.timezone,
      ),
      ...(city ? { city } : {}),
      sourceUrl,
      priceStatus:
        price?.toLowerCase() === 'free'
          ? 'FREE'
          : price?.toLowerCase() === 'paid'
            ? 'PAID'
            : 'UNKNOWN',
    });
    await ctx.reply(
      `✅ Akce uložena jako ${event.verificationStatus}; cena se bez důkazu nepovažuje za bezplatnou.`,
    );
  });
  bot.command('socials_sources', async (ctx) => {
    await replyLong(
      ctx,
      `🔎 Zdroje akcí\n\n${socialEventSources.map((source) => `• ${source.name} — ${source.mode}\n  ${source.notes}\n  ${source.url}`).join('\n\n')}`,
    );
  });
  bot.command('socials_contacts', async (ctx) => {
    if (!ctx.from) return;
    const argument = commandArgument(ctx);
    if (argument.toLowerCase().startsWith('add ')) {
      const [attendanceId, displayName, organization, notes] = argument
        .slice(4)
        .split('|')
        .map((part) => part.trim());
      if (!attendanceId || !displayName) {
        await ctx.reply(
          'Použití: /socials_contacts add ATTENDANCE_ID | Jméno | organizace | poznámka',
        );
        return;
      }
      await dependencies.store.addContact({
        ownerUserId: BigInt(ctx.from.id),
        attendanceId,
        displayName,
        ...(organization ? { organization } : {}),
        ...(notes ? { conversationNotes: notes } : {}),
      });
      await ctx.reply(
        '✅ Kontakt uložen soukromě. Žádná zpráva nebude automaticky odeslána.',
      );
      return;
    }
    if (argument.toLowerCase().startsWith('followup ')) {
      const [contactId, title, dueDate] = argument
        .slice(9)
        .split('|')
        .map((part) => part.trim());
      const match = dueDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
      if (!contactId || !title || !match) {
        await ctx.reply(
          'Použití: /socials_contacts followup CONTACT_ID | Co udělat | 2026-10-20',
        );
        return;
      }
      const followUp = await dependencies.store.createFollowUp({
        ownerUserId: BigInt(ctx.from.id),
        contactId,
        title,
        dueAt: dateInTimezone(
          {
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3]),
            hour: 9,
            minute: 0,
          },
          dependencies.timezone,
        ),
      });
      await ctx.reply(
        `✅ Follow-up uložen. ID: ${followUp.id}. Bot pouze připomene; nic neodešle za tebe.`,
      );
      return;
    }
    if (argument.toLowerCase().startsWith('done ')) {
      await dependencies.store.completeFollowUp(
        BigInt(ctx.from.id),
        argument.slice(5).trim(),
      );
      await ctx.reply('✅ Follow-up označen jako dokončený.');
      return;
    }
    if (argument.toLowerCase().startsWith('delete ')) {
      await dependencies.store.deleteContact(
        BigInt(ctx.from.id),
        argument.slice(7).trim(),
      );
      await ctx.reply('🗑️ Kontakt a jeho follow-upy byly odstraněny.');
      return;
    }
    const contacts = await dependencies.store.listContacts(BigInt(ctx.from.id));
    await replyLong(
      ctx,
      `👥 Kontakty a follow-upy\n${contacts.map((contact) => `• ${contact.displayName}${contact.organization ? ` · ${contact.organization}` : ''}\n  Contact ID: ${contact.id}\n${contact.followUps.map((followUp) => `  ⏰ ${formatPragueDateTime(followUp.dueAt, dependencies.timezone)} — ${followUp.title} (${followUp.id})`).join('\n') || '  bez otevřeného follow-upu'}`).join('\n') || 'Žádné kontakty.'}\n\nPříkazy: add · followup · done · delete. Nic se neposílá automaticky kontaktům.`,
    );
  });
  bot.callbackQuery('social:plan', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startPlanning(ctx, dependencies);
  });
  bot.callbackQuery('social:ideas', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderIdeas(ctx, dependencies);
  });
  bot.callbackQuery('social:trends', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderTrendOverview(ctx, dependencies);
  });
  bot.callbackQuery(/^social:trend:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderTrendDetail(ctx, dependencies, ctx.match[1]!);
  });
  bot.callbackQuery(/^social:trenduse:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const idea = await dependencies.trendStore.convertOpportunityToIdea(
      BigInt(ctx.from.id),
      ctx.match[1]!,
    );
    await ctx.reply(`✅ Přidáno do zásobníku: ${idea.title}`);
  });
  bot.callbackQuery(/^social:tf:([RNSGPL]):([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const kind = trendFeedbackSchema.parse(
      (
        {
          R: 'RELEVANT',
          N: 'NOT_RELEVANT',
          S: 'ALREADY_SATURATED',
          G: 'GOOD_IDEA',
          P: 'PUBLISHED',
          L: 'GENERATED_LEADS',
        } as const
      )[ctx.match[1] as 'R' | 'N' | 'S' | 'G' | 'P' | 'L'],
    );
    await dependencies.trendStore.addFeedback({
      ownerUserId: BigInt(ctx.from.id),
      opportunityId: ctx.match[2]!,
      kind,
    });
    await ctx.reply('✅ Feedback uložen.');
  });
  bot.callbackQuery('social:week', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPlan(ctx, dependencies);
  });
  bot.callbackQuery('social:networking', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderEvents(ctx, dependencies);
  });
  bot.callbackQuery('social:history', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const items = await dependencies.store.listContent(BigInt(ctx.from.id), {
      statuses: ['PUBLISHED'],
      limit: 20,
    });
    await ctx.reply(
      items.map((item) => `• ${item.channel}: ${item.title}`).join('\n') ||
        'Historie je prázdná.',
    );
  });
  bot.callbackQuery('social:pack', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const result = await dependencies.service.contentPack(BigInt(ctx.from.id));
    if (!result) {
      await ctx.reply('Nejdřív vytvoř plán přes /socials_plan.');
      return;
    }
    await ctx.replyWithDocument(
      new InputFile(
        new TextEncoder().encode(result.pack.markdown),
        `socials-content-pack-v${result.pack.version}.md`,
      ),
    );
  });
  bot.callbackQuery(/^social:approve:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await dependencies.store.approveWeeklyPlan(
      BigInt(ctx.from.id),
      ctx.match[1]!,
    );
    const notion = await dependencies.service.synchronizeNotion(
      BigInt(ctx.from.id),
    );
    await ctx.reply(
      `✅ Plán schválen.${notion ? ` Notion: ${notion.synced} synchronizováno, ${notion.conflicts} konfliktů, ${notion.failed} chyb.` : ' Notion není nakonfigurovaný.'}`,
    );
  });
  bot.callbackQuery(/^social:check:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const item = await dependencies.store.toggleChecklist(
      BigInt(ctx.from.id),
      ctx.match[1]!,
    );
    await ctx.reply(
      item
        ? `${item.completed ? '✅' : '⬜'} ${item.title}`
        : 'Položka už neexistuje.',
    );
  });
  bot.callbackQuery(/^social:import:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) return;
    await dependencies.store.startSession({
      ownerUserId: BigInt(ctx.from.id),
      chatId: BigInt(ctx.chat.id),
      sessionType: 'CONTENT_IMPORT',
      state: 'WAITING_FOR_CONTENT',
      payload: { contentItemId: ctx.match[1]! },
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
    await ctx.reply(
      'Vlož celý draft jako text nebo Markdown soubor. Uložím novou verzi.',
    );
  });
  bot.callbackQuery(/^social:edit:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) return;
    await dependencies.store.startSession({
      ownerUserId: BigInt(ctx.from.id),
      chatId: BigInt(ctx.chat.id),
      sessionType: 'CONTENT_EDIT',
      state: 'WAITING_FOR_TEXT',
      payload: { contentItemId: ctx.match[1]! },
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
    await ctx.reply(
      'Pošli úpravu: Název | úhel | hook (volitelně) | CTA (volitelně). Změnit lze jen položku neschváleného plánu.',
    );
  });
  bot.callbackQuery(/^social:refresh:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await dependencies.service.refreshPrompt(
      BigInt(ctx.from.id),
      ctx.match[1]!,
    );
    await ctx.reply(
      '♻️ Prompt byl znovu deterministicky sestaven z aktuálních ověřených dat.',
    );
  });
  bot.callbackQuery(/^social:remove:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const removed = await dependencies.store.removeDraftContentItem(
      BigInt(ctx.from.id),
      ctx.match[1]!,
    );
    await ctx.reply(`🗑️ Z neschváleného plánu odstraněno: ${removed.title}`);
  });
  bot.callbackQuery(
    /^social:att:(INTERESTED|REGISTERED|CANCELLED):([\w-]+)$/u,
    async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!ctx.from) return;
      const attendance = await dependencies.store.setAttendance({
        ownerUserId: BigInt(ctx.from.id),
        eventId: ctx.match[2]!,
        status: ctx.match[1] as 'INTERESTED' | 'REGISTERED' | 'CANCELLED',
      });
      await ctx.reply(
        `✅ Stav účasti: ${attendance.status}. Otevření odkazu se samo nepovažuje za registraci.`,
      );
    },
  );
  bot.callbackQuery(/^social:attended:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) return;
    await dependencies.store.startSession({
      ownerUserId: BigInt(ctx.from.id),
      chatId: BigInt(ctx.chat.id),
      sessionType: 'EVENT_DEBRIEF',
      state: 'QUESTION',
      payload: { attendanceId: ctx.match[1]!, index: 0, answers: {} },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    });
    await ctx.reply(debriefQuestions[0][1]);
  });
  bot.callbackQuery(/^social:eventidea:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) return;
    const attendances = await dependencies.store.listAttendances(
      BigInt(ctx.from.id),
    );
    const attendance = attendances.find((item) => item.id === ctx.match[1]);
    if (!attendance || attendance.status !== 'ATTENDED') {
      await ctx.reply(
        'Nápad lze vytvořit jen z potvrzené účasti a vlastního debriefu.',
      );
      return;
    }
    const note = `Co jsem si odnesl z akce ${attendance.event.title}: ${attendance.lessons ?? attendance.highlights ?? attendance.notes ?? 'bez dostatečných vlastních poznámek'}`;
    const captured = await dependencies.service.captureIdea(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
      note,
      'NETWORKING_EVENT',
    );
    if (captured.created) {
      await dependencies.store.linkEventIdea({
        ownerUserId: BigInt(ctx.from.id),
        attendanceId: attendance.id,
        contentIdeaId: captured.idea.id,
        provenanceNotes:
          'Vytvořeno pouze z potvrzené účasti a soukromého debriefu; jména kontaktů nebyla zahrnuta.',
      });
    }
    await ctx.reply(
      captured.created
        ? `✅ Volitelný nápad uložen: ${captured.idea.title}`
        : `Podobný nápad už existuje: ${captured.idea.title}`,
    );
  });
  bot.on('message:voice', async (ctx) => {
    if (!dependencies.transcriber || !dependencies.download) {
      await ctx.reply(
        'Přepis hlasu není nakonfigurovaný. Pošli prosím odpověď jako text.',
      );
      return;
    }
    try {
      const bytes = await dependencies.download(ctx.message.voice.file_id);
      const text = await dependencies.transcriber.transcribe(
        bytes,
        'voice.ogg',
      );
      await ctx.reply(`📝 Přepis: ${text}`);
      await handleSessionAnswer(ctx, dependencies, text);
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply(
        'Hlasovou zprávu se nepodařilo přepsat. Pošli prosím text.',
      );
    }
  });
  bot.on('message:document', async (ctx) => {
    if (!dependencies.download || !ctx.from || !ctx.chat) return;
    const session = await dependencies.store.activeSession(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
    );
    if (
      session?.sessionType !== 'CONTENT_IMPORT' &&
      session?.sessionType !== 'TREND_IMPORT'
    ) {
      return;
    }
    const document = ctx.message.document;
    const filename = document.file_name?.toLocaleLowerCase('en-US') ?? '';
    const allowed =
      session.sessionType === 'TREND_IMPORT'
        ? filename.endsWith('.json') ||
          filename.endsWith('.csv') ||
          document.mime_type === 'application/json' ||
          document.mime_type === 'text/csv' ||
          document.mime_type === 'text/plain'
        : filename.endsWith('.md') ||
          document.mime_type === 'text/markdown' ||
          document.mime_type === 'text/plain';
    if (!allowed) {
      await ctx.reply(
        session.sessionType === 'TREND_IMPORT'
          ? 'Pro trendový import použij CSV nebo JSON soubor.'
          : 'Pro import použij Markdown nebo textový soubor.',
      );
      return;
    }
    const bytes = await dependencies.download(document.file_id);
    if (bytes.byteLength > 1_000_000) {
      await ctx.reply('Soubor je příliš velký; limit je 1 MB.');
      return;
    }
    await handleSessionAnswer(
      ctx,
      dependencies,
      new TextDecoder().decode(bytes),
    );
  });
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await handleSessionAnswer(ctx, dependencies, ctx.message.text);
  });
  bot.catch((error) => dependencies.reportError(error.error));
  return bot;
};
