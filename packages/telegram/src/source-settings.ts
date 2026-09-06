import { InlineKeyboard } from 'grammy';

export type GlobalSourceSetting<TSource extends string = string> = {
  source: TSource;
  enabled: boolean;
};

export const globalSourceKeyboard = (
  settings: GlobalSourceSetting[],
  callbackPrefix: string,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  settings.forEach((setting, index) => {
    keyboard.text(
      `${setting.enabled ? '✅' : '❌'} ${setting.source}`,
      `${callbackPrefix}:${index}`,
    );
    if (index < settings.length - 1) keyboard.row();
  });
  return keyboard;
};

export const globalSourceSettingsText = (
  watcherName: string,
  targetCount: number,
  targetName: string,
): string => {
  const plural = targetName.endsWith('y')
    ? `${targetName.slice(0, -1)}ies`
    : `${targetName}s`;
  return [
    `⚙️ ${watcherName} sources`,
    `These switches apply to all ${targetCount} configured ${targetCount === 1 ? targetName : plural} and to every ${targetName} added later.`,
  ].join('\n\n');
};
