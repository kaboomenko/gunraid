import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  battleClientSeed,
  battleRoll,
  hexToFloat,
  hmacSha256Hex,
  rollFloat,
  sha256Hex,
  verifyServerSeed,
} from './fair.js';

describe('provably fair', () => {
  it('matches node:crypto HMAC-SHA256 and SHA-256', () => {
    const key = 'a3f1c0ffee'.repeat(6);
    const msg = 'client-seed:42:0';
    expect(hmacSha256Hex(key, msg)).toBe(createHmac('sha256', key).update(msg).digest('hex'));
    expect(sha256Hex(key)).toBe(createHash('sha256').update(key).digest('hex'));
  });

  it('uses the first 52 bits as a float in [0, 1)', () => {
    expect(hexToFloat('0000000000000ffff')).toBe(0);
    expect(hexToFloat('fffffffffffff')).toBeLessThan(1);
    expect(hexToFloat('8000000000000')).toBe(0.5);
  });

  it('is deterministic for the same seeds and nonce (fixed vector)', () => {
    const server = 'e1b5d6c3f0a94b8d9a7c6e5f4d3c2b1a0918273645546372819a0b1c2d3e4f50';
    const a = rollFloat(server, 'my-seed', 7);
    expect(rollFloat(server, 'my-seed', 7)).toBe(a);
    expect(rollFloat(server, 'my-seed', 8)).not.toBe(a);
    const expected =
      parseInt(createHmac('sha256', server).update('my-seed:7:0').digest('hex').slice(0, 13), 16) / 2 ** 52;
    expect(a).toBe(expected);
  });

  it('verifies a revealed server seed against its hash', () => {
    const seed = 'f'.repeat(64);
    expect(verifyServerSeed(seed, sha256Hex(seed))).toBe(true);
    expect(verifyServerSeed(seed, sha256Hex('x'))).toBe(false);
  });

  it('derives battle rolls from all participant seeds', () => {
    const cs = battleClientSeed(['a', 'b', 'bot:1']);
    expect(cs).toMatch(/^[0-9a-f]{64}$/);
    expect(battleRoll('srv', cs, 0, 0)).not.toBe(battleRoll('srv', cs, 0, 1));
  });
});
