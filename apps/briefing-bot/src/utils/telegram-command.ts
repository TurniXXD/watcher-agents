type TelegramCommandEntity = {
  offset: number;
  length: number;
  type: string;
};

type TelegramTextMessage = {
  text?: string;
  entities?: TelegramCommandEntity[];
};

const legacyCommandPattern =
  /^\/([a-z0-9]+(?:-[a-z0-9]+)+)(@[a-z0-9_]+)?(?=\s|$)/i;

export const normalizeHyphenatedBotCommand = (
  message: TelegramTextMessage | undefined,
): void => {
  if (!message?.text) return;
  const match = legacyCommandPattern.exec(message.text);
  if (!match) return;

  const command = match[1];
  if (!command) return;
  const normalizedToken = `/${command.replaceAll('-', '_')}${match[2] ?? ''}`;
  message.text = normalizedToken + message.text.slice(match[0].length);

  const entity = message.entities?.find(
    ({ offset, type }) => offset === 0 && type === 'bot_command',
  );
  if (entity) entity.length = normalizedToken.length;
};
