import { describe, expect, it } from 'vitest';
import {
  CARGO_IMAGE_KINDS,
  CARGO_MAX_SEATS,
  CARGO_SEED_RE,
  CARGO_SLUG_RE,
  cargoBuySchema,
  cargoImageUrl,
  cargoImageVariant,
} from './cargo.js';
import { DROP_SOURCES } from './cases.js';
import { PUBLIC_ROOM_RE, WS_ROOMS } from './ws.js';

const ROUND_ID = '019ac0de-0000-7000-8000-000000000001';

describe('cargoImageVariant', () => {
  it('maps a standard image to its downscaled copies', () => {
    for (const kind of CARGO_IMAGE_KINDS) {
      const url = cargoImageUrl(kind);
      expect(url).toBe(`/media/cargo/${kind}.webp`);
      expect(cargoImageVariant(url, 256)).toBe(`/media/cargo/${kind}-256.webp`);
      expect(cargoImageVariant(url, 500)).toBe(`/media/cargo/${kind}-500.webp`);
      expect(cargoImageVariant(url, 1000)).toBe(url);
    }
  });

  it('keeps a custom path as is', () => {
    for (const url of [
      '/uploads/cargo/x.webp',
      'https://cdn.example.com/media/cargo/light.webp',
      '/media/cargo/light-500.webp',
      '/media/cargo/light.png',
      '/media/cargo/unknown.webp',
    ]) {
      expect(cargoImageVariant(url, 256)).toBe(url);
      expect(cargoImageVariant(url, 500)).toBe(url);
    }
  });
});

describe('cargoBuySchema', () => {
  it('requires a client seed in the safe alphabet', () => {
    const ok = { roundId: ROUND_ID, count: 2, clientSeed: '0123456789abcdef0123456789abcdef' };
    expect(cargoBuySchema.parse(ok)).toEqual(ok);
    expect(cargoBuySchema.safeParse({ roundId: ROUND_ID, count: 1 }).success).toBe(false);
    for (const clientSeed of ['short', 'a:bcdefgh', 'with space', 'кириллица', 'x'.repeat(65)]) {
      expect(CARGO_SEED_RE.test(clientSeed)).toBe(false);
      expect(cargoBuySchema.safeParse({ ...ok, clientSeed }).success).toBe(false);
    }
    expect(CARGO_SEED_RE.test('Az09_-Az09')).toBe(true);
  });

  it('limits the count and rejects extra keys', () => {
    const base = { roundId: ROUND_ID, clientSeed: 'aaaaaaaa' };
    expect(cargoBuySchema.safeParse({ ...base, count: CARGO_MAX_SEATS }).success).toBe(true);
    for (const count of [0, -1, 1.5, CARGO_MAX_SEATS + 1]) {
      expect(cargoBuySchema.safeParse({ ...base, count }).success).toBe(false);
    }
    expect(cargoBuySchema.safeParse({ ...base, count: 1, extra: true }).success).toBe(false);
    expect(cargoBuySchema.safeParse({ ...base, roundId: 'nope', count: 1 }).success).toBe(false);
  });
});

describe('cargo wiring', () => {
  it('lets clients subscribe to the per-game cargo room', () => {
    expect(WS_ROOMS.cargo('standoff2')).toBe('cargo:standoff2');
    expect(PUBLIC_ROOM_RE.test(WS_ROOMS.cargo('cs2'))).toBe(true);
    expect(PUBLIC_ROOM_RE.test(WS_ROOMS.feed('cs2'))).toBe(true);
    expect(PUBLIC_ROOM_RE.test(WS_ROOMS.battle(ROUND_ID))).toBe(true);
    expect(PUBLIC_ROOM_RE.test(WS_ROOMS.user(ROUND_ID))).toBe(false);
    expect(PUBLIC_ROOM_RE.test('cargo:')).toBe(false);
  });

  it('accepts slugs of standard cargo kinds and the feed knows the cargo source', () => {
    for (const kind of CARGO_IMAGE_KINDS) expect(CARGO_SLUG_RE.test(kind)).toBe(true);
    expect(CARGO_SLUG_RE.test('Light')).toBe(false);
    expect(DROP_SOURCES).toContain('cargo');
  });
});
