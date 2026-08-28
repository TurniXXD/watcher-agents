import type { MiddlewareFn } from 'grammy';

export const parseAllowedUserIds = (value: string): ReadonlySet<number> => {
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^\d+$/.test(part))
        throw new Error(`Invalid Telegram user ID: ${part}`);
      return Number(part);
    });

  if (ids.length === 0)
    throw new Error('TELEGRAM_ALLOWED_USER_IDS must not be empty');
  return new Set(ids);
};

export const isAuthorized = (
  allowedUserIds: ReadonlySet<number>,
  userId: number | undefined,
): boolean => userId !== undefined && allowedUserIds.has(userId);

export const authorizationMiddleware =
  (allowedUserIds: ReadonlySet<number>): MiddlewareFn =>
  async (context, next) => {
    if (!isAuthorized(allowedUserIds, context.from?.id)) {
      if (context.callbackQuery)
        await context.answerCallbackQuery('Unauthorized');
      else if (context.message) await context.reply('Unauthorized.');
      return;
    }

    await next();
  };
