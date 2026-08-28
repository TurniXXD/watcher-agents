import { describe, expect, it } from 'vitest';
import { isAuthorized, parseAllowedUserIds } from '../authorization.js';
import { splitTelegramMessage } from '../messages.js';

describe('Telegram utilities', () => {
  it('authorizes only configured user IDs', () => {
    const ids = parseAllowedUserIds('123, 456');
    expect(isAuthorized(ids, 123)).toBe(true);
    expect(isAuthorized(ids, 999)).toBe(false);
    expect(isAuthorized(ids, undefined)).toBe(false);
  });

  it('rejects invalid allowlist values', () => {
    expect(() => parseAllowedUserIds('123,nope')).toThrow(
      'Invalid Telegram user ID',
    );
  });

  it('splits messages without exceeding Telegram limits', () => {
    const parts = splitTelegramMessage(
      `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`,
      80,
    );
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.length <= 80)).toBe(true);
  });
});
