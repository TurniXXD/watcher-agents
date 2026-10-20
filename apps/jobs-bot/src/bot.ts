import type { JobStore } from '@watcher/database';
import { candidateProfileSchema } from '@watcher/jobs';
import {
  authorizationMiddleware,
  commandArgument,
  sendSplitMessage,
} from '@watcher/telegram';
import { Bot } from 'grammy';
import type { JobDiscoveryRunner } from './runner.js';

const escapeHtml = (value: string): string =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

export const jobsBotCommands = [
  { command: 'start', description: 'Open the private job-search bot' },
  { command: 'help', description: 'Show commands and examples' },
  { command: 'about', description: 'About matching and data limitations' },
  { command: 'jobs_run', description: 'Run sources; append dry to preview' },
  { command: 'jobs_status', description: 'Show source and schedule status' },
  { command: 'jobs_sources', description: 'List enabled and disabled sources' },
  { command: 'jobs_latest', description: 'Show the latest matching jobs' },
  { command: 'jobs_show', description: 'Show one job and its evaluation' },
  { command: 'jobs_search', description: 'Search jobs by title or company' },
  { command: 'jobs_applications', description: 'List tracked applications' },
  { command: 'jobs_source', description: 'Enable or disable one source' },
  { command: 'jobs_mark', description: 'Update a job application status' },
  { command: 'jobs_note', description: 'Add a private note to a job' },
  { command: 'jobs_followup', description: 'Set or clear a follow-up date' },
  { command: 'jobs_profile', description: 'Show or replace candidate profile' },
  { command: 'jobs_reevaluate', description: 'Re-score stored jobs' },
] as const;

export const jobsStart = [
  '💼 Personal Job Discovery is ready.',
  '',
  'It checks permitted public job sources, stores history in PostgreSQL, scores new vacancies against your private candidate profile, and sends relevant new matches after the baseline import.',
  'Use /help for commands or /jobs_run all dry to preview collection without writes or alerts.',
].join('\n');

export const jobsHelp = [
  '💼 Personal Job Discovery',
  '',
  '/start – open the bot without changing settings or starting a run',
  '/jobs_run – run all enabled sources',
  '/jobs_run remote-ok – run one source',
  '/jobs_run all dry – discover without database writes or alerts',
  '/jobs_status – scheduler and source health',
  '/jobs_sources – source support and disabled reasons',
  '/jobs_latest – latest scored vacancies and their IDs',
  '/jobs_show JOB_ID – full job detail, evidence and application notes',
  '/jobs_search QUERY – search title or company',
  '/jobs_applications [STATUS] – tracked application pipeline',
  '/jobs_source remote-ok off – disable a supported source',
  '/jobs_source remote-ok on – enable a supported source',
  '/jobs_mark JOB_ID SAVED – update an application status; valid values are NEW, SAVED, DISMISSED, INTERESTED, APPLIED, RECRUITER_CONTACTED, INTERVIEW_SCHEDULED, TECHNICAL_INTERVIEW, OFFER, REJECTED, WITHDRAWN',
  '/jobs_note JOB_ID Follow up Friday – add a private note',
  '/jobs_followup JOB_ID 2026-11-03 – set a follow-up date; use clear to remove it',
  '/jobs_profile – show the active profile',
  '/jobs_profile {"name":"Candidate",...} – replace the complete profile after validation',
  '/jobs_reevaluate – re-score stored jobs after a profile change',
  '/help – this command list',
  '/about – matching rules and limitations',
].join('\n');

export const jobsAbout = [
  'ℹ️ About Personal Job Discovery',
  '',
  'This private bot is for one authorized operator. PostgreSQL is the authoritative store for candidate settings, source checkpoints, jobs, evaluations, schedules, delivery state, and application notes.',
  'It automatically reads only configured public APIs/RSS feeds, normalizes and deduplicates listings, applies deterministic eligibility/scoring rules, and sends new qualifying matches through Telegram or an optional operator-owned e-mail webhook. Optional local/OpenAI-compatible AI nuance scoring is validated and cannot remove deterministic blockers.',
  'You must explicitly decide whether to save, dismiss, apply, contact anyone, or change an application status. The bot never submits applications, contacts employers, bypasses access controls, or claims that an aggregator listing is still open.',
  'All Telegram updates require an allowed user ID. Secrets remain server-side. Scores can be uncertain and must be checked against the original listing; unsupported sources stay disabled.',
  'Use /help next, or /jobs_run all dry for a no-write source preview.',
].join('\n');

const applicationStatuses = [
  'NEW',
  'SAVED',
  'DISMISSED',
  'INTERESTED',
  'APPLIED',
  'RECRUITER_CONTACTED',
  'INTERVIEW_SCHEDULED',
  'TECHNICAL_INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
] as const;

const isApplicationStatus = (
  value: string,
): value is (typeof applicationStatuses)[number] =>
  applicationStatuses.some((status) => status === value);

export const createJobsBot = (input: {
  token: string;
  allowedUserIds: ReadonlySet<number>;
  store: JobStore;
  runner: JobDiscoveryRunner;
  onRunComplete: (
    chatId: bigint,
    alerts: Awaited<ReturnType<JobDiscoveryRunner['run']>>['alerts'],
  ) => Promise<number>;
  reportError: (error: unknown) => void;
}): Bot => {
  const bot = new Bot(input.token);
  bot.use(authorizationMiddleware(input.allowedUserIds));
  bot.command('start', (context) => context.reply(jobsStart));
  bot.command('help', (context) => context.reply(jobsHelp));
  bot.command('about', (context) => context.reply(jobsAbout));
  bot.command('jobs_run', async (context) => {
    const parts = commandArgument(context.message?.text)
      .split(/\s+/u)
      .filter(Boolean);
    const sourceId = parts.find((part) => part !== 'all' && part !== 'dry');
    const dryRun = parts.includes('dry');
    const pending = await context.reply('⏳ Collecting job sources…');
    try {
      const result = await input.runner.run({
        trigger: 'MANUAL',
        ...(sourceId ? { sourceId } : {}),
        dryRun,
      });
      const delivered = await input.onRunComplete(
        BigInt(context.chat.id),
        result.alerts,
      );
      if (
        result.status !== 'SKIPPED' &&
        result.runId !== 'dry-run' &&
        result.runId !== 'overlap-prevented'
      )
        await input.store.recordRunNotifications(result.runId, delivered);
      await context.api.editMessageText(
        context.chat.id,
        pending.message_id,
        `Run ${result.status.toLowerCase()}: ${result.discovered} discovered, ${result.created} new, ${result.evaluated} evaluated, ${result.sourceFailures} source failures${result.baseline ? '. Baseline import: alerts suppressed.' : '.'}`,
      );
    } catch (error) {
      await context.api.editMessageText(
        context.chat.id,
        pending.message_id,
        `Run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('jobs_status', async (context) => {
    const [, , , , lastRun, sources] = await input.store.getOverview();
    const schedules = await input.store.listSchedules();
    await context.reply(
      [
        `Last run: ${lastRun ? `${lastRun.status} · ${lastRun.startedAt.toISOString()}` : 'none'}`,
        `Healthy sources: ${sources.filter((source) => source.healthStatus === 'HEALTHY').length}/${sources.filter((source) => source.enabled).length} enabled`,
        `Schedule: ${schedules.map((schedule) => `${schedule.scheduleKey} → ${schedule.nextRunAt.toISOString()} (${schedule.timezone})`).join(', ')}`,
      ].join('\n'),
    );
  });
  bot.command('jobs_sources', async (context) => {
    const sources = await input.store.listSources();
    await sendSplitMessage(
      context.api,
      BigInt(context.chat.id),
      escapeHtml(
        sources
          .map(
            (source) =>
              `${source.enabled ? '✅' : '⏸️'} ${source.id} · ${source.healthStatus}${source.disabledReason ? `\n   ${source.disabledReason}` : ''}`,
          )
          .join('\n'),
      ),
    );
  });
  bot.command('jobs_latest', async (context) => {
    const jobs = await input.store.listJobs({ minimumScore: 55, take: 10 });
    if (jobs.length === 0) {
      await context.reply('No evaluated matching jobs yet. Run /jobs_run.');
      return;
    }
    await sendSplitMessage(
      context.api,
      BigInt(context.chat.id),
      escapeHtml(
        jobs
          .map((job) => {
            const score = job.evaluations[0]?.score ?? 0;
            return `• ${job.title} — ${job.company} (${score}/100)\nID: ${job.id}\n${job.canonicalApplicationUrl ?? job.originalUrl}`;
          })
          .join('\n\n'),
      ),
    );
  });
  bot.command('jobs_show', async (context) => {
    const jobId = commandArgument(context.message?.text).trim();
    if (!jobId) {
      await context.reply('Usage: /jobs_show JOB_ID');
      return;
    }
    const job = await input.store.getJob(jobId);
    if (!job) {
      await context.reply('Job not found.');
      return;
    }
    const evaluation = job.evaluations[0];
    const application = job.application;
    const text = [
      `💼 ${job.title}`,
      `Company: ${job.company}`,
      `Location: ${job.location ?? 'Not specified'} · ${job.workMode}`,
      ...(job.salaryMin || job.salaryMax
        ? [
            `Salary: ${job.salaryMin ?? '?'}–${job.salaryMax ?? '?'} ${job.salaryCurrency ?? ''}`.trim(),
          ]
        : []),
      `Availability: ${job.availabilityStatus}`,
      `Published: ${job.publishedAt?.toISOString() ?? 'Unknown'}`,
      `Match: ${evaluation ? `${evaluation.score}/100 · ${evaluation.eligibility} · ${evaluation.recommendation}` : 'Not evaluated'}`,
      ...(evaluation
        ? [
            `Why: ${evaluation.reasoning}`,
            `Matching skills: ${evaluation.matchingSkills.join(', ') || 'None detected'}`,
            `Missing skills: ${evaluation.missingSkills.join(', ') || 'None detected'}`,
            `Blockers: ${evaluation.hardBlockers.join('; ') || 'None'}`,
            `Uncertainties: ${evaluation.uncertainties.join('; ') || 'None'}`,
          ]
        : []),
      `Application: ${application?.status ?? 'NEW'}${application?.followUpAt ? ` · follow-up ${application.followUpAt.toISOString().slice(0, 10)}` : ''}`,
      ...(application?.notes.map((note) => `Note: ${note.note}`) ?? []),
      `Sources: ${job.sourceReferences.map((reference) => reference.source.name).join(', ')}`,
      `Apply: ${job.canonicalApplicationUrl ?? job.originalUrl}`,
      '',
      job.description.slice(0, 5_000),
    ].join('\n');
    await sendSplitMessage(
      context.api,
      BigInt(context.chat.id),
      escapeHtml(text),
    );
  });
  bot.command('jobs_search', async (context) => {
    const query = commandArgument(context.message?.text).trim();
    if (!query) {
      await context.reply('Usage: /jobs_search QUERY');
      return;
    }
    const jobs = await input.store.listJobs({ query, take: 20 });
    await sendSplitMessage(
      context.api,
      BigInt(context.chat.id),
      escapeHtml(
        jobs.length
          ? jobs
              .map(
                (job) =>
                  `• ${job.title} — ${job.company} (${job.evaluations[0]?.score ?? 0}/100)\nID: ${job.id}`,
              )
              .join('\n\n')
          : 'No matching stored jobs.',
      ),
    );
  });
  bot.command('jobs_applications', async (context) => {
    const rawStatus = commandArgument(context.message?.text)
      .trim()
      .toUpperCase();
    if (rawStatus && !isApplicationStatus(rawStatus)) {
      await context.reply(
        'Unknown application status. See /help for supported statuses.',
      );
      return;
    }
    const status =
      rawStatus && isApplicationStatus(rawStatus) ? rawStatus : undefined;
    const jobs = await input.store.listJobs({
      ...(status ? { status } : {}),
      take: 50,
    });
    const tracked = status
      ? jobs
      : jobs.filter((job) => job.application?.status !== 'NEW');
    await sendSplitMessage(
      context.api,
      BigInt(context.chat.id),
      escapeHtml(
        tracked.length
          ? tracked
              .map(
                (job) =>
                  `• ${job.application?.status ?? 'NEW'} · ${job.title} — ${job.company}${job.application?.followUpAt ? ` · follow-up ${job.application.followUpAt.toISOString().slice(0, 10)}` : ''}\nID: ${job.id}`,
              )
              .join('\n\n')
          : 'No tracked applications for this filter.',
      ),
    );
  });
  bot.command('jobs_source', async (context) => {
    const [sourceId, state, ...extra] = commandArgument(
      context.message?.text,
    ).split(/\s+/u);
    if (
      !sourceId ||
      !state ||
      extra.length > 0 ||
      !['on', 'off'].includes(state)
    ) {
      await context.reply('Usage: /jobs_source SOURCE_ID on|off');
      return;
    }
    try {
      const source = await input.store.setSourceEnabled(
        sourceId,
        state === 'on',
      );
      await context.reply(`${source.enabled ? '✅' : '⏸️'} ${source.id}`);
    } catch (error) {
      await context.reply(
        `Source update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('jobs_mark', async (context) => {
    const [jobId, rawStatus, ...extra] = commandArgument(
      context.message?.text,
    ).split(/\s+/u);
    const status = rawStatus?.toUpperCase();
    if (!jobId || !status || extra.length > 0 || !isApplicationStatus(status)) {
      await context.reply(
        'Usage: /jobs_mark JOB_ID STATUS — see /help for statuses.',
      );
      return;
    }
    try {
      await input.store.updateApplication(jobId, {
        status,
        unread: false,
        saved: status === 'SAVED' || status === 'INTERESTED',
      });
      await context.reply(`✅ ${jobId} → ${status}`);
    } catch (error) {
      await context.reply(
        `Application update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('jobs_note', async (context) => {
    const argument = commandArgument(context.message?.text);
    const separator = argument.indexOf(' ');
    const jobId = separator < 0 ? '' : argument.slice(0, separator).trim();
    const note = separator < 0 ? '' : argument.slice(separator + 1).trim();
    if (!jobId || !note) {
      await context.reply('Usage: /jobs_note JOB_ID NOTE');
      return;
    }
    try {
      await input.store.updateApplication(jobId, { note });
      await context.reply(`📝 Note saved for ${jobId}.`);
    } catch (error) {
      await context.reply(
        `Note update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('jobs_followup', async (context) => {
    const [jobId, rawDate, ...extra] = commandArgument(
      context.message?.text,
    ).split(/\s+/u);
    if (!jobId || !rawDate || extra.length > 0) {
      await context.reply('Usage: /jobs_followup JOB_ID YYYY-MM-DD|clear');
      return;
    }
    let followUpAt: Date | null;
    if (rawDate.toLowerCase() === 'clear') {
      followUpAt = null;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(rawDate)) {
        await context.reply('Follow-up date must use YYYY-MM-DD or clear.');
        return;
      }
      followUpAt = new Date(`${rawDate}T09:00:00.000Z`);
      if (
        Number.isNaN(followUpAt.getTime()) ||
        followUpAt.toISOString().slice(0, 10) !== rawDate
      ) {
        await context.reply('Follow-up date is invalid.');
        return;
      }
    }
    try {
      await input.store.updateApplication(jobId, { followUpAt });
      await context.reply(
        followUpAt
          ? `✅ Follow-up set to ${rawDate}.`
          : '✅ Follow-up cleared.',
      );
    } catch (error) {
      await context.reply(
        `Follow-up update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('jobs_profile', async (context) => {
    const argument = commandArgument(context.message?.text).trim();
    const active = await input.store.getActiveProfile();
    if (!active) throw new Error('Candidate profile is not initialized');
    if (!argument) {
      await sendSplitMessage(
        context.api,
        BigInt(context.chat.id),
        escapeHtml(JSON.stringify(active.profile, null, 2)),
      );
      return;
    }
    try {
      const profile = candidateProfileSchema.parse(JSON.parse(argument));
      await input.store.updateProfile(active.row.id, profile);
      const reevaluated = await input.runner.reevaluateExisting();
      await context.reply(
        `✅ Candidate profile updated. Re-evaluated ${reevaluated.evaluated} of ${reevaluated.scanned} stored jobs.`,
      );
    } catch (error) {
      await context.reply(
        `Profile update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.command('jobs_reevaluate', async (context) => {
    const pending = await context.reply('⏳ Re-evaluating stored jobs…');
    try {
      const result = await input.runner.reevaluateExisting();
      await context.api.editMessageText(
        context.chat.id,
        pending.message_id,
        `✅ Re-evaluated ${result.evaluated} of ${result.scanned} stored jobs.`,
      );
    } catch (error) {
      await context.api.editMessageText(
        context.chat.id,
        pending.message_id,
        `Re-evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  bot.catch((error) => input.reportError(error.error));
  return bot;
};
