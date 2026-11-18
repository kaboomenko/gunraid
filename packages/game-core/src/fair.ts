import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Provably fair: результат = HMAC_SHA256(key = serverSeed, msg = "{clientSeed}:{nonce}:{cursor}").
 * Первые 52 бита (13 hex-символов) → число с плавающей точкой в [0, 1).
 * Один и тот же код работает на сервере и в браузере (страница проверки).
 */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export function hmacSha256Hex(key: string, message: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(message)));
}

export const FLOAT_BITS = 52;

export function hexToFloat(hex: string): number {
  if (!/^[0-9a-f]{13,}$/i.test(hex)) throw new RangeError('hex too short');
  return parseInt(hex.slice(0, 13), 16) / 2 ** FLOAT_BITS;
}

export function fairMessage(clientSeed: string, nonce: number, cursor = 0): string {
  return `${clientSeed}:${nonce}:${cursor}`;
}

export function rollFloat(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor = 0,
): number {
  return hexToFloat(hmacSha256Hex(serverSeed, fairMessage(clientSeed, nonce, cursor)));
}

/** Client seed баттла: SHA-256 от client seed'ов участников по порядку слотов. */
export function battleClientSeed(slotSeeds: string[]): string {
  return sha256Hex(slotSeeds.join(':'));
}

/** Бросок для раунда r и слота s баттла. */
export function battleRoll(
  serverSeed: string,
  battleClientSeedHex: string,
  round: number,
  slot: number,
): number {
  return hexToFloat(hmacSha256Hex(serverSeed, `${battleClientSeedHex}:${round}:${slot}`));
}

/** Дополнительный бросок для ничьей в баттле. */
export function battleTiebreak(serverSeed: string, battleClientSeedHex: string): number {
  return hexToFloat(hmacSha256Hex(serverSeed, `${battleClientSeedHex}:tiebreak`));
}

/** Проверка, что раскрытый server seed соответствует заранее показанному хэшу. */
export function verifyServerSeed(serverSeed: string, expectedHash: string): boolean {
  return sha256Hex(serverSeed) === expectedHash.toLowerCase();
}

export const CLIENT_SEED_RE = /^[\x21-\x7E]{1,64}$/;
