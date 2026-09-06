import { describe, expect, it } from 'vitest';
import {
  globalSourceKeyboard,
  globalSourceSettingsText,
} from '../source-settings.js';

describe('global source settings', () => {
  it('renders one compact callback per globally configured source', () => {
    const keyboard = globalSourceKeyboard(
      [
        { source: 'SEC', enabled: true },
        { source: 'NEWS', enabled: false },
      ],
      'ss',
    );

    expect(keyboard.inline_keyboard).toEqual([
      [{ text: '✅ SEC', callback_data: 'ss:0' }],
      [{ text: '❌ NEWS', callback_data: 'ss:1' }],
    ]);
  });

  it('explains that settings apply to current and future entries', () => {
    expect(globalSourceSettingsText('Stock watcher', 2, 'stock')).toContain(
      'all 2 configured stocks',
    );
    expect(
      globalSourceSettingsText('Publications watcher', 2, 'query'),
    ).toContain('all 2 configured queries');
  });
});
