export type StockNotificationPolicy = {
  batchWindowMinutes: number;
  notificationStartHour: number;
  notificationEndHour: number;
  extremeImmediate: boolean;
};

export const defaultStockNotificationPolicy: StockNotificationPolicy = {
  batchWindowMinutes: 60,
  notificationStartHour: 7,
  notificationEndHour: 22,
  extremeImmediate: true,
};

const localHour = (date: Date, timezone: string): number =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date),
  );

export const stockAlertDeliverAfter = (
  analyzedAt: Date,
  severity: 'INFO' | 'MEDIUM' | 'HIGH' | 'EXTREME',
  timezone: string,
  policy: StockNotificationPolicy = defaultStockNotificationPolicy,
): Date => {
  if (severity === 'EXTREME' && policy.extremeImmediate) return analyzedAt;
  const candidate = new Date(
    analyzedAt.getTime() + policy.batchWindowMinutes * 60_000,
  );
  const hour = localHour(candidate, timezone);
  if (
    hour >= policy.notificationStartHour &&
    hour < policy.notificationEndHour
  ) {
    return candidate;
  }
  const next = new Date(candidate);
  for (let index = 0; index < 36 * 60; index += 1) {
    next.setTime(next.getTime() + 60_000);
    if (localHour(next, timezone) === policy.notificationStartHour) return next;
  }
  return candidate;
};
