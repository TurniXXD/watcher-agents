import type { SalesStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { SalesService } from '../service.js';
import type { SalesIntelligenceService } from '../sales-intelligence.js';
import {
  createSalesBot,
  parseSalesFind,
  parseSalesSearch,
  salesAbout,
  salesBotCommands,
  salesHelp,
} from '../bot.js';

const update = (text: string, updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1_788_704_068,
    chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      {
        offset: 0,
        length: text.indexOf(' ') === -1 ? text.length : text.indexOf(' '),
        type: 'bot_command' as const,
      },
    ],
  },
});

const callbackUpdate = (data: string, updateId: number, userId = 123) => ({
  update_id: updateId,
  callback_query: {
    id: `callback-${updateId}`,
    from: { id: userId, is_bot: false, first_name: 'Operator' },
    chat_instance: 'test-chat',
    data,
    message: {
      message_id: updateId,
      date: 1_788_704_068,
      chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
      text: 'Přidat tento lead do Twenty CRM?',
    },
  },
});

describe('sales bot help', () => {
  it.each(['/start', '/help', '/sales_help'])(
    'serves the detailed guide for %s',
    async (command) => {
      const bot = createSalesBot(
        'test-token',
        new Set([123]),
        {} as SalesStore,
        {} as SalesService,
      );
      bot.botInfo = {
        id: 456,
        is_bot: true,
        first_name: 'Sales Bot',
        username: 'sales_test_bot',
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      };
      const messages: string[] = [];
      bot.api.config.use(async (_previous, method, payload) => {
        if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
        if (!('text' in payload) || typeof payload.text !== 'string')
          throw new Error('Expected sendMessage text');
        messages.push(payload.text);
        return { ok: true, result: { message_id: 1 } } as never;
      });

      await bot.handleUpdate(update(command, command.length));

      expect(messages.join('\n\n')).toBe(salesHelp);
      expect(messages.every((message) => message.length <= 3900)).toBe(true);
    },
  );

  it.each(['/about', '/sales_about'])(
    'serves the detailed about text for %s',
    async (command) => {
      const bot = createSalesBot(
        'test-token',
        new Set([123]),
        {} as SalesStore,
        {} as SalesService,
      );
      bot.botInfo = {
        id: 456,
        is_bot: true,
        first_name: 'Sales Bot',
        username: 'sales_test_bot',
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      };
      const messages: string[] = [];
      bot.api.config.use(async (_previous, method, payload) => {
        if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
        if (!('text' in payload) || typeof payload.text !== 'string')
          throw new Error('Expected sendMessage text');
        messages.push(payload.text);
        return { ok: true, result: { message_id: 1 } } as never;
      });

      await bot.handleUpdate(update(command, command.length + 100));

      expect(messages.length).toBeGreaterThan(0);
      const delivered = messages.join('\n');
      expect(delivered).toContain('💼 O Sales assistantovi');
      expect(delivered).toContain('GOOGLE_PLACES_API_KEY');
      expect(delivered).toContain('GEOAPIFY_API_KEY');
      expect(delivered).toContain('ARES');
      expect(delivered).toContain('Podmínky odeslání');
    },
  );

  it('documents every sales command and the approval boundary', () => {
    for (const command of [
      '/sales_status',
      '/sales_campaigns',
      '/sales_prospects <service>',
      '/sales_search <service>',
      '/sales_searches',
      '/sales_search_stop <id|all>',
      '/sales_find <campaign-id>',
      '/sales_calls [limit]',
      '/sales_leads',
      '/sales_lead <id>',
      '/sales_approve <id>',
      '/sales_reject <id>',
      '/sales_run',
      '/link_to_lead <url>',
    ]) {
      expect(salesHelp).toContain(command);
    }
    expect(salesHelp).toContain('does not establish consent');
    expect(salesHelp).toContain('/about or /sales_about');
    expect(salesHelp).toContain('read-only inbound mailbox');
  });

  it('publishes the detailed about command in the Telegram menu', () => {
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_about' }),
    );
    expect(salesAbout).toContain('RECIPIENT_OPT_IN');
    expect(salesAbout).toContain('Twenty CRM');
    expect(salesAbout).toContain('Quickly');
    expect(salesAbout).toContain('GOOGLE_PLACES_API_KEY');
    expect(salesAbout).toContain('GEOAPIFY_API_KEY');
    expect(salesAbout).toContain('Firmy.cz');
    expect(salesAbout).toContain('Inbound IMAP');
    expect(salesAbout).toContain('Nikdy na e-mail automaticky neodpovídá');
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_prospects' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_search' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_searches' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_search_stop' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_find' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_campaigns' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_calls' }),
    );
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'link_to_lead' }),
    );
  });

  it('previews a linked website and writes to Twenty only after owner confirmation', async () => {
    const leadId = '11111111-1111-4111-8111-111111111111';
    const lead = {
      id: leadId,
      companyName: 'Example s.r.o.',
      websiteUrl: 'https://example.com/',
      stage: 'DISCOVERED',
      twentyCompanyId: null,
      email: 'info@example.com',
      phone: null,
      research: {
        researchedAt: new Date('2026-10-29T08:00:00.000Z'),
        profile: { description: 'Example company' },
        outreach: {
          recommendedChannel: 'email',
          primaryOffer: 'Web audit',
          angle: 'Public finding',
          conversationOpener: 'Hello',
          subject: 'Audit',
          body: 'Draft only',
        },
        technicalAudit: {
          usesHttps: true,
          hasMobileViewport: true,
          hasDescription: true,
          headingCount: 1,
          imagesMissingAlt: 0,
          detectedTechnologies: ['Next.js'],
        },
        contacts: [
          {
            type: 'general_email',
            value: 'info@example.com',
            verificationStatus: 'verified_public',
          },
        ],
        opportunities: [],
        sourceUrls: ['https://example.com/'],
      },
    };
    const link = vi.fn().mockResolvedValue(lead);
    const syncLinkedLeadToTwenty = vi
      .fn()
      .mockResolvedValue({ companyId: 'company-1' });
    const bot = createSalesBot(
      'test-token',
      new Set([123]),
      {} as SalesStore,
      { syncLinkedLeadToTwenty } as unknown as SalesService,
      undefined,
      30,
      { link } as unknown as SalesIntelligenceService,
    );
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Sales Bot',
      username: 'sales_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };
    const methods: string[] = [];
    bot.api.config.use(async (_previous, method) => {
      methods.push(method);
      return {
        ok: true,
        result: method === 'sendMessage' ? { message_id: 1 } : true,
      } as never;
    });

    await bot.handleUpdate(update('/link_to_lead https://example.com', 700));

    expect(link).toHaveBeenCalledWith('https://example.com');
    expect(syncLinkedLeadToTwenty).not.toHaveBeenCalled();
    expect(methods.filter((method) => method === 'sendMessage')).toHaveLength(
      2,
    );

    await bot.handleUpdate(callbackUpdate(`sales:link:confirm:${leadId}`, 701));

    expect(syncLinkedLeadToTwenty).toHaveBeenCalledWith(leadId);
    expect(methods).toContain('answerCallbackQuery');
    expect(methods).toContain('editMessageReplyMarkup');
  });

  it('parses bounded discovery input', () => {
    expect(parseSalesFind('campaign | autoservis | Brno | 15')).toEqual({
      campaignId: 'campaign',
      query: 'autoservis',
      locality: 'Brno',
      limit: 15,
    });
    expect(parseSalesFind('campaign | autoservis | Brno')).toMatchObject({
      limit: 10,
    });
    expect(parseSalesFind('campaign | autoservis | Brno | 21')).toBeUndefined();
  });

  it('parses a bounded periodic search without a campaign', () => {
    expect(parseSalesSearch('autoservis | Brno | 15')).toEqual({
      query: 'autoservis',
      locality: 'Brno',
      limit: 15,
    });
    expect(parseSalesSearch('autoservis | Brno')).toEqual({
      query: 'autoservis',
      locality: 'Brno',
      limit: 10,
    });
    expect(parseSalesSearch('autoservis | Brno | 0')).toBeUndefined();
    expect(parseSalesSearch('autoservis | Brno | 21')).toBeUndefined();
  });

  it('imports campaign-free prospects into Twenty with a default limit of ten', async () => {
    const syncProspects = vi.fn().mockResolvedValue({
      found: 10,
      withWebsite: 8,
      created: 7,
      alreadyPresent: 1,
      synced: 7,
      failures: [],
      category: {
        geoapifyCategory: 'service.vehicle.repair.car',
        naceCode: '95310',
        source: 'rule',
      },
    });
    const bot = createSalesBot(
      'test-token',
      new Set([123]),
      {} as SalesStore,
      { syncProspects } as unknown as SalesService,
    );
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Sales Bot',
      username: 'sales_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };
    const messages: string[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
      if (!('text' in payload) || typeof payload.text !== 'string')
        throw new Error('Expected sendMessage text');
      messages.push(payload.text);
      return { ok: true, result: { message_id: 1 } } as never;
    });

    await bot.handleUpdate(update('/sales_prospects autoservis | Brno', 450));

    expect(syncProspects).toHaveBeenCalledWith({
      query: 'autoservis',
      locality: 'Brno',
      limit: 10,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('ukládám nové prospekty do Twenty');
    expect(messages[1]).toContain('10 nalezeno');
    expect(messages[1]).toContain('7 synchronizováno do Twenty');
    expect(messages[1]).toContain('1 již dříve přidáno');
  });

  it('prints a linked contact list and persists the periodic search', async () => {
    const searchBusinessesDetailed = vi.fn().mockResolvedValue({
      companies: [
        {
          id: 'place-1',
          name: 'Autoservis Test',
          provider: 'GEOAPIFY',
          phone: '+420 123 456 789',
          address: 'Brno',
          websiteUrl: 'https://autoservis.example',
          sourceUrl: 'https://maps.google.com/example',
        },
      ],
      category: {
        geoapifyCategory: 'service.vehicle.repair.car',
        naceCode: '95310',
        source: 'rule',
      },
    });
    const upsertSearchSubscription = vi.fn().mockResolvedValue({
      id: 'search-1',
    });
    const completeSearchSubscription = vi.fn().mockResolvedValue(undefined);
    const bot = createSalesBot(
      'test-token',
      new Set([123]),
      {
        upsertSearchSubscription,
        completeSearchSubscription,
      } as unknown as SalesStore,
      { searchBusinessesDetailed } as unknown as SalesService,
      undefined,
      45,
    );
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Sales Bot',
      username: 'sales_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };
    const messages: string[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
      if (!('text' in payload) || typeof payload.text !== 'string')
        throw new Error('Expected sendMessage text');
      messages.push(payload.text);
      return { ok: true, result: { message_id: 1 } } as never;
    });

    await bot.handleUpdate(update('/sales_search autoservis | Brno | 2', 500));

    expect(searchBusinessesDetailed).toHaveBeenCalledWith({
      query: 'autoservis',
      locality: 'Brno',
      limit: 2,
    });
    expect(upsertSearchSubscription).toHaveBeenCalledWith({
      telegramChatId: 123n,
      telegramUserId: 123n,
      query: 'autoservis',
      locality: 'Brno',
      resultLimit: 2,
      intervalMinutes: 45,
    });
    expect(completeSearchSubscription).toHaveBeenCalledWith('search-1', [
      expect.any(String),
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('45 minut');
    expect(messages[1]).toContain('<b>1. Autoservis Test</b>');
    expect(messages[1]).toContain('<b>Web:</b> <a href=');
    expect(messages[1]).toContain('otevřít detail</a>');
    expect(messages[1]).not.toMatch(/[│┌┐└┘├┤┬┴┼]/u);
    expect(messages[1]).not.toContain('<pre>');
    expect(messages[1]).toContain('Autoservis Test');
    expect(messages[1]).toContain('+420 123 456 789');
    expect(messages[1]).toContain(
      'Geoapify kategorie: service.vehicle.repair.car',
    );
    expect(messages[2]).toContain('search-1');
    expect(messages[2]).toContain('pouze nové kontakty');
  });
});
