import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token format: `vch_<keyId>_<secret>`; only a SHA-256 of the token is stored. */
const TOKEN_PATTERN = /^vch_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/u;

export type ParsedToken = { keyId: string; token: string };

export const generateCredential = (): {
  keyId: string;
  token: string;
  secretHash: string;
} => {
  const keyId = randomBytes(8).toString('hex');
  const token = `vch_${keyId}_${randomBytes(32).toString('base64url')}`;
  return { keyId, token, secretHash: hashToken(token) };
};

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const parseBearerToken = (header: string | null): ParsedToken | null => {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim());
  const token = match?.[1];
  if (!token) return null;
  const parts = TOKEN_PATTERN.exec(token);
  return parts?.[1] ? { keyId: parts[1], token } : null;
};

export const tokenMatches = (token: string, secretHash: string): boolean => {
  const expected = Buffer.from(secretHash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export type CredentialRecord = {
  id: string;
  botId: string;
  keyId: string;
  secretHash: string;
  scopes?: string[] | null;
  active?: boolean | null;
  expiresAt?: string | null;
};

export type CredentialCheck =
  | { ok: true; credential: CredentialRecord }
  | {
      ok: false;
      status: 401 | 403;
      reason: 'invalid_token' | 'inactive' | 'expired' | 'scope';
    };

export const checkCredential = (
  token: ParsedToken,
  record: CredentialRecord | null,
  scope: string,
  now = new Date(),
): CredentialCheck => {
  if (
    !record ||
    record.keyId !== token.keyId ||
    !tokenMatches(token.token, record.secretHash)
  ) {
    return { ok: false, status: 401, reason: 'invalid_token' };
  }
  if (!record.active) return { ok: false, status: 401, reason: 'inactive' };
  if (record.expiresAt && new Date(record.expiresAt) <= now)
    return { ok: false, status: 401, reason: 'expired' };
  if (!record.scopes?.includes(scope))
    return { ok: false, status: 403, reason: 'scope' };
  return { ok: true, credential: record };
};
