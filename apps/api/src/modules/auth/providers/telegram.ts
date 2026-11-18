import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramAuthPayload } from '@gunraid/shared';

const MAX_AGE_SEC = 86_400;

/**
 * Проверка данных Telegram Login Widget:
 * secret = SHA256(bot_token); hash = HMAC_SHA256(data_check_string, secret).
 */
export function verifyTelegramAuth(
  data: Omit<TelegramAuthPayload, 'intent'>,
  botToken: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const { hash, ...fields } = data;
  const checkString = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  if (nowSec - data.auth_date > MAX_AGE_SEC || data.auth_date - nowSec > 300) return false;
  return true;
}
