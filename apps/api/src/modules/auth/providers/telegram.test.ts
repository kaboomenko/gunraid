import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTelegramAuth } from './telegram.js';

const TOKEN = '123456:ABC-DEF';

function sign(fields: Record<string, string | number>): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(TOKEN).digest();
  return createHmac('sha256', secret).update(check).digest('hex');
}

describe('verifyTelegramAuth', () => {
  const now = 1_800_000_000;
  const fields = { id: 42, first_name: 'Ivan', username: 'ivan', auth_date: now - 60 };

  it('accepts a correctly signed payload', () => {
    expect(verifyTelegramAuth({ ...fields, hash: sign(fields) }, TOKEN, now)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    expect(verifyTelegramAuth({ ...fields, id: 43, hash: sign(fields) }, TOKEN, now)).toBe(false);
  });

  it('rejects a payload signed with another bot token', () => {
    const otherSecret = createHash('sha256').update('999:other').digest();
    const check = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const hash = createHmac('sha256', otherSecret).update(check).digest('hex');
    expect(verifyTelegramAuth({ ...fields, hash }, TOKEN, now)).toBe(false);
  });

  it('rejects stale auth_date', () => {
    const old = { ...fields, auth_date: now - 2 * 86_400 };
    expect(verifyTelegramAuth({ ...old, hash: sign(old) }, TOKEN, now)).toBe(false);
  });
});
