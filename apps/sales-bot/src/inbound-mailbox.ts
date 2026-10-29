import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export type InboundMailboxConfiguration = {
  address: string;
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  lookbackDays: number;
  maxMessages: number;
};

export type InboundEmailAddress = {
  address: string;
  name?: string;
};

export type InboundEmailMessage = {
  eventId: string;
  messageId?: string;
  receivedAt: Date;
  from: InboundEmailAddress;
  replyTo: InboundEmailAddress[];
  subject: string;
  text: string;
  automated: boolean;
  contactFormHint: boolean;
};

const clean = (value: string, max: number): string =>
  value
    .split('\u0000')
    .join('')
    .replaceAll(/\r\n?/gu, '\n')
    .trim()
    .slice(0, max);

const headerText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .join(' ');
  return '';
};

const address = (
  input: { address?: string; name?: string } | undefined,
): InboundEmailAddress | undefined => {
  const email = input?.address?.trim().toLowerCase();
  if (!email) return undefined;
  return {
    address: email,
    ...(input?.name?.trim() ? { name: clean(input.name, 200) } : {}),
  };
};

const eventId = (input: {
  messageId?: string;
  receivedAt: Date;
  from: string;
  subject: string;
  text: string;
}): string => {
  const identity = input.messageId?.trim()
    ? `message-id:${input.messageId.trim().toLowerCase()}`
    : [
        input.receivedAt.toISOString(),
        input.from.toLowerCase(),
        input.subject,
        input.text,
      ].join('\n');
  return `sales:inbound-email:${createHash('sha256').update(identity).digest('hex')}`;
};

export const readInboundMailbox = async (
  configuration: InboundMailboxConfiguration,
): Promise<InboundEmailMessage[]> => {
  const client = new ImapFlow({
    host: configuration.host,
    port: configuration.port,
    secure: true,
    auth: { user: configuration.user, pass: configuration.password },
    logger: false,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  client.on('error', () => {
    // The polling boundary logs a redacted failure; mailbox credentials stay private.
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
        Date.now() - configuration.lookbackDays * 24 * 60 * 60_000,
      );
      const searchResult = await client.search({ since }, { uid: true });
      if (!Array.isArray(searchResult))
        throw new Error('Inbound mailbox search failed');
      if (searchResult.length === 0) return [];
      const newest = searchResult.slice(-configuration.maxMessages);
      const summaries = await client.fetchAll(
        newest,
        { envelope: true, size: true },
        { uid: true },
      );
      const messages: InboundEmailMessage[] = [];
      for (const summary of summaries) {
        if ((summary.size ?? Infinity) > 2_000_000) continue;
        const fetched = await client.fetchOne(
          summary.uid,
          { source: true },
          { uid: true },
        );
        if (!fetched || !fetched.source) continue;
        const parsed = await simpleParser(fetched.source, {
          skipImageLinks: true,
          maxHtmlLengthToParse: 1_000_000,
        });
        const from = address(parsed.from?.value[0]);
        if (!from) continue;
        const replyTo = (parsed.replyTo?.value ?? [])
          .map((entry) => address(entry))
          .filter((entry): entry is InboundEmailAddress => Boolean(entry));
        const subject = clean(parsed.subject ?? '', 500);
        const text = clean(parsed.text ?? '', 50_000);
        const autoSubmitted = headerText(
          parsed.headers.get('auto-submitted'),
        ).toLowerCase();
        const precedence = headerText(
          parsed.headers.get('precedence'),
        ).toLowerCase();
        const automated =
          (autoSubmitted.length > 0 && autoSubmitted !== 'no') ||
          /^(?:bulk|junk|list)$/u.test(precedence) ||
          parsed.headers.has('list-unsubscribe');
        const contactFormHint =
          /contact form|website enquiry|website inquiry|web form|kontaktní formulář|poptávka z webu/iu.test(
            `${subject}\n${text.slice(0, 2_000)}`,
          );
        const receivedValue =
          parsed.date ?? summary.envelope?.date ?? new Date();
        const receivedAt =
          receivedValue instanceof Date
            ? receivedValue
            : new Date(receivedValue);
        if (Number.isNaN(receivedAt.getTime())) continue;
        const messageId = parsed.messageId?.trim();
        messages.push({
          eventId: eventId({
            ...(messageId ? { messageId } : {}),
            receivedAt,
            from: from.address,
            subject,
            text,
          }),
          ...(messageId ? { messageId } : {}),
          receivedAt,
          from,
          replyTo,
          subject,
          text,
          automated,
          contactFormHint,
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  } finally {
    if (connected) await client.logout();
    else client.close();
  }
};
