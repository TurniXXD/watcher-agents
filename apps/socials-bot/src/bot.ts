import { assertPublicHttpUrl } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';
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
    .text('📅 Tento týden', 'social:week');

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
  timezone: string;
  transcriber?: SocialTranscriber;
  download?: (fileId: string) => Promise<Uint8Array>;
  reportError: (error: unknown) => void;
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
    if (session?.sessionType !== 'CONTENT_IMPORT') return;
    const document = ctx.message.document;
    if (
      !document.file_name?.toLowerCase().endsWith('.md') &&
      document.mime_type !== 'text/markdown' &&
      document.mime_type !== 'text/plain'
    ) {
      await ctx.reply('Pro import použij Markdown nebo textový soubor.');
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
