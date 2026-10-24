import type { JobStore } from '@watcher/database';
import type { Bot } from 'grammy';
import { sendSplitMessage } from '@watcher/telegram';
import type { AlertJob } from './runner.js';

const escapeHtml = (value: string): string =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

export const renderJobDigest = (jobs: AlertJob[]): string =>
  [
    `🚀 ${jobs.length} new matching job${jobs.length === 1 ? '' : 's'}`,
    '',
    ...jobs
      .toSorted((left, right) => right.score - left.score)
      .flatMap((job, index) => [
        `${index + 1}. ${job.title}`,
        `Company: ${job.company}`,
        `Location: ${job.location ?? 'Not specified'}`,
        `Match: ${job.score}/100 · ${job.eligibility.toLowerCase()}`,
        ...(job.salary ? [`Salary: ${job.salary}`] : []),
        `Why: ${job.reasoning}`,
        ...(job.hardBlockers?.length
          ? [`Blockers: ${job.hardBlockers.join('; ')}`]
          : []),
        ...(job.uncertainties?.length
          ? [`Needs review: ${job.uncertainties.join('; ')}`]
          : []),
        `Source: ${job.source}`,
        `Published: ${job.publishedAt?.toISOString() ?? 'Unknown'}`,
        `Apply: ${job.url}`,
        '',
      ]),
  ].join('\n');

export const deliverJobDigest = async (input: {
  bot: Bot;
  chatIds: readonly bigint[];
  store: JobStore;
  jobs: AlertJob[];
  email?: { url: string; recipient: string; apiKey?: string };
}): Promise<number> => {
  if (input.jobs.length === 0) return 0;
  const text = renderJobDigest(input.jobs);
  const providers = [
    ...input.chatIds.map((chatId) => ({
      provider: 'telegram',
      recipient: chatId.toString(),
      deliver: () => sendSplitMessage(input.bot.api, chatId, escapeHtml(text)),
    })),
    ...(input.email
      ? [
          {
            provider: 'email-webhook',
            recipient: input.email.recipient,
            deliver: () =>
              fetch(input.email!.url, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  ...(input.email!.apiKey
                    ? { authorization: `Bearer ${input.email!.apiKey}` }
                    : {}),
                },
                body: JSON.stringify({
                  to: input.email!.recipient,
                  subject: `${input.jobs.length} new matching jobs`,
                  text,
                  html: `<pre>${escapeHtml(text)}</pre>`,
                }),
                signal: AbortSignal.timeout(30_000),
              }).then((response) => {
                if (!response.ok)
                  throw new Error(
                    `Email webhook returned HTTP ${response.status}`,
                  );
              }),
          },
        ]
      : []),
  ];
  const deliveries = await Promise.allSettled(
    providers.map((provider) => provider.deliver()),
  );
  await Promise.all(
    input.jobs.flatMap((job) =>
      deliveries.map((delivery, index) => {
        const provider = providers[index]!;
        const error =
          delivery.status === 'rejected'
            ? delivery.reason instanceof Error
              ? delivery.reason.message
              : String(delivery.reason)
            : undefined;
        return input.store.recordNotificationDelivery({
          notificationId: job.notificationId,
          provider: provider.provider,
          recipient: provider.recipient,
          sent: delivery.status === 'fulfilled',
          ...(error ? { error } : {}),
        });
      }),
    ),
  );
  const sent = deliveries.some((delivery) => delivery.status === 'fulfilled');
  await Promise.all(
    input.jobs.map((job) =>
      input.store.markNotification(
        job.notificationId,
        sent,
        sent ? undefined : 'All configured notification providers failed',
      ),
    ),
  );
  return sent ? input.jobs.length : 0;
};
