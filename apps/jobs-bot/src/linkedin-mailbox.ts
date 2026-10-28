import type { LinkedinAlertMessage } from '@watcher/jobs';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export type LinkedinMailboxConfiguration = {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  lookbackDays: number;
};

const linkedinAddress = (value: string): boolean =>
  value.toLowerCase().endsWith('@linkedin.com');

export const readLinkedinAlerts = async (
  configuration: LinkedinMailboxConfiguration,
): Promise<LinkedinAlertMessage[]> => {
  const client = new ImapFlow({
    host: configuration.host,
    port: configuration.port,
    secure: true,
    auth: {
      user: configuration.user,
      pass: configuration.password,
    },
    logger: false,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  client.on('error', () => {
    // The caller receives operation failures; do not log mailbox credentials.
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock(configuration.mailbox, {
      readOnly: true,
      acquireTimeout: 10_000,
    });
    try {
      const since = new Date(
        Date.now() - configuration.lookbackDays * 24 * 3_600_000,
      );
      const searchResult = await client.search({ since }, { uid: true });
      if (!Array.isArray(searchResult))
        throw new Error('LinkedIn mailbox search failed');
      if (searchResult.length === 0) return [];
      const newest = searchResult.slice(-100);
      const summaries = await client.fetchAll(
        newest,
        { envelope: true, size: true },
        { uid: true },
      );
      const candidates = summaries.filter(
        (message) =>
          (message.size ?? Infinity) <= 1_000_000 &&
          message.envelope?.from?.some((sender) =>
            linkedinAddress(sender.address ?? ''),
          ),
      );
      const alerts: LinkedinAlertMessage[] = [];
      for (const message of candidates) {
        const fetched = await client.fetchOne(
          message.uid,
          { source: true },
          { uid: true },
        );
        if (!fetched || !fetched.source) continue;
        const parsed = await simpleParser(fetched.source, {
          skipHtmlToText: true,
          skipImageLinks: true,
          maxHtmlLengthToParse: 1_000_000,
        });
        const from = parsed.from?.value.find((sender) =>
          linkedinAddress(sender.address ?? ''),
        )?.address;
        if (!from || typeof parsed.html !== 'string') continue;
        alerts.push({
          from,
          subject: parsed.subject ?? '',
          html: parsed.html,
          receivedAt: parsed.date ?? new Date(),
        });
      }
      return alerts;
    } finally {
      lock.release();
    }
  } finally {
    if (connected) await client.logout();
    else client.close();
  }
};
