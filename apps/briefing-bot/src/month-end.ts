export const monthEndAction =
  'Zaplať zálohy OSVČ a zhodnoť své měkké dovednosti, finance a pokrok u všech cílů.';

export const monthEndSpokenReminder = `Měsíční připomínka. ${monthEndAction}`;

export const isLastCalendarDayOfMonth = (localDate: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(localDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
};
