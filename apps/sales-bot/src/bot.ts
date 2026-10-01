import { Bot, type Context } from 'grammy';
import type { SalesStore } from '@watcher/database';
import {
  authorizationMiddleware,
  splitTelegramMessage,
} from '@watcher/telegram';
import type { SalesService } from './service.js';

export const salesHelp = `💼 Sales assistant

This private bot reviews discovered companies, prepares outreach drafts, and—when configured—syncs eligible, approved leads to Quickly and Twenty.

Getting started
1. Run /sales_status to check the current pipeline counts.
2. Run /sales_run to discover and score leads now, or wait for the scheduled run.
3. Open /sales_leads and copy a lead ID.
4. Review the complete record with /sales_lead <id>.
5. Use /sales_approve <id> or /sales_reject <id> only after reviewing the company, contact evidence, draft, and outreach basis.

Commands
/help or /sales_help — show this guide
/sales_status — show campaign count, recent leads, qualified leads, and Quickly enrollments
/sales_leads — list the 10 most recent leads with IDs, stages, and scores
/sales_lead <id> — show one lead's company details, public contact data and source, draft, and current Quickly eligibility
/sales_approve <id> — record manual approval; the lead is enrolled only if every remaining eligibility check passes
/sales_reject <id> — reject the lead so it is not enrolled
/sales_run — immediately run discovery, analysis, scoring, and configured CRM/email synchronization

Lead stages and integrations
QUALIFIED means the automated checks passed; it is not approval to contact. SYNCED_TO_QUICKLY means the lead was enrolled in Quickly. Quickly and Twenty synchronization stays inactive until their API keys are configured. A partial run can still keep valid results when one provider fails.

Safety and compliance
Approval records an operator decision only. It does not establish consent, legitimate interest, or any other legal basis. Verify the recipient, source, suppression/reply state, local law, campaign settings, and final copy before outreach. Never treat generated text or discovered contact data as automatically safe to use.`;

const send = async (ctx: Context, message: string) => {
  for (const part of splitTelegramMessage(message, 3900)) {
    await ctx.reply(part);
  }
};

export const createSalesBot = (
  token: string,
  allowedUserIds: ReadonlySet<number>,
  store: SalesStore,
  service: SalesService,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedUserIds));
  bot.command(['start', 'help', 'sales_help'], (ctx) => send(ctx, salesHelp));
  bot.command('sales_status', async (ctx) => {
    const campaigns = await store.listCampaigns();
    const leads = await store.listLeads(undefined, 100);
    await ctx.reply(
      `Campaigns: ${campaigns.length}; recent leads: ${leads.length}; qualified: ${leads.filter((lead) => lead.stage === 'QUALIFIED').length}; Quickly enrolled: ${leads.filter((lead) => lead.stage === 'SYNCED_TO_QUICKLY').length}.`,
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
  bot.catch((error) => {
    console.error('Sales Telegram error', error.error);
  });
  return bot;
};
