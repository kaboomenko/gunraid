import { createHash, createHmac } from 'node:crypto';
import { formatGems, type CargoProofDto } from '@gunraid/shared';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';
import {
  CARGO_PROOF_HEAD,
  cargoPreimageHead,
  cargoProofOutcome,
  cargoProofRows,
  verifyCargoProof,
  type CargoProofRow,
} from './cargo-proof';

// Контрольный вектор game-core (cargo.test.ts): строка, client seed раунда, float 0.2415…, место 3.
const SERVER_SEED = 'e1b5d6c3f0a94b8d9a7c6e5f4d3c2b1a0918273645546372819a0b1c2d3e4f50';
const PURCHASES = [
  { seatFrom: 1, seatTo: 3, clientSeed: 'aaaaaaaa', mine: false },
  { seatFrom: 4, seatTo: 4, clientSeed: 'bbbbbbbb', mine: true },
  { seatFrom: 5, seatTo: 10, clientSeed: 'cccccccc', mine: false },
];
const PREIMAGE = '[[1,3,"aaaaaaaa"],[4,4,"bbbbbbbb"],[5,10,"cccccccc"]]';
const CLIENT_SEED = '2b950d061c8c513d3e11ac3d0253a05dc29332f8e747546f8bd2f41ee231e13a';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function proof(over: Partial<CargoProofDto> = {}): CargoProofDto {
  return {
    type: 'cargo',
    id: '01a21963-a263-7634-bb25-ce9c62dee779',
    cargoName: 'Лёгкий груз',
    number: 7,
    status: 'landed',
    revealed: true,
    serverSeed: SERVER_SEED,
    serverSeedHash: sha256(SERVER_SEED),
    clientSeed: CLIENT_SEED,
    purchases: PURCHASES,
    seatsSold: 10,
    seatsTotal: 10,
    minSeatsToLand: null,
    landReason: 'sold_out',
    winningSeat: 3,
    voidSeat: null,
    winner: { shortId: 1001, nickname: 'Winner' },
    prize: { itemId: 'item-1', name: 'M9 Bayonet "Dragon Glass"', price: 13700, imageUrl: null },
    startedAt: '2026-11-26T10:00:00.000Z',
    finishedAt: '2026-11-26T12:00:00.000Z',
    ...over,
  };
}

/** Раунд без победителя с продажами: закрыт по минимуму (D36) или отменён (D33). */
const voided = (status: 'expired' | 'cancelled', voidSeat: number | null = 3) =>
  proof({
    status,
    landReason: status === 'expired' ? 'min_seats' : null,
    minSeatsToLand: status === 'expired' ? 50 : null,
    seatsTotal: 100,
    winningSeat: null,
    voidSeat,
    winner: null,
  });

const empty = (status: 'expired' | 'cancelled') =>
  proof({
    status,
    landReason: status === 'expired' ? 'deadline' : null,
    clientSeed: null,
    purchases: [],
    seatsSold: 0,
    winningSeat: null,
    winner: null,
  });

const keys = (p: CargoProofDto) => verifyCargoProof(p).checks.map((c) => `${c.key}:${c.ok}`);

describe('проверка груза: исход раунда', () => {
  it('по статусу и продажам', () => {
    expect(cargoProofOutcome(proof({ status: 'open' }))).toBe('open');
    expect(cargoProofOutcome(proof())).toBe('landed');
    expect(cargoProofOutcome(empty('expired'))).toBe('noSales');
    expect(cargoProofOutcome(voided('expired'))).toBe('minSeats');
    expect(cargoProofOutcome(voided('cancelled'))).toBe('cancelled');
    expect(cargoProofOutcome(empty('cancelled'))).toBe('cancelledEmpty');
  });

  it('продажи видны и по одному списку покупок, если число мест разошлось', () => {
    expect(cargoProofOutcome({ status: 'expired', seatsSold: 0, purchases: PURCHASES })).toBe(
      'minSeats',
    );
  });
});

describe('проверка груза: галочки', () => {
  it('приземлившийся раунд: все проверки сходятся, место совпадает с пересчётом node:crypto', () => {
    const v = verifyCargoProof(proof());
    expect(v.outcome).toBe('landed');
    expect(v.checks).toEqual([
      { key: 'hash', ok: true },
      { key: 'seats', ok: true },
      { key: 'client', ok: true },
      { key: 'seat', ok: true },
    ]);
    // Независимо от game-core — по формуле из how5 и docs: SHA-256 строки JSON и HMAC с nonce 0.
    expect(sha256(PREIMAGE)).toBe(CLIENT_SEED);
    const hmac = createHmac('sha256', SERVER_SEED).update(`${CLIENT_SEED}:0:0`).digest('hex');
    const float = parseInt(hmac.slice(0, 13), 16) / 2 ** 52;
    expect(v.clientSeed).toBe(CLIENT_SEED);
    expect(v.sold).toBe(10);
    expect(v.float).toBe(float);
    expect(v.float).toBeCloseTo(0.24156344243204542, 15);
    expect(v.seat).toBe(Math.floor(float * 10) + 1);
    expect(v.seat).toBe(3);
    expect(v.seatOwner).toBe(0);
  });

  it('чужой хэш server seed — красная только проверка хэша', () => {
    expect(keys(proof({ serverSeedHash: sha256('other') }))).toEqual([
      'hash:false',
      'seats:true',
      'client:true',
      'seat:true',
    ]);
  });

  it('пропуск мест: места и client seed не сходятся', () => {
    const gap = [PURCHASES[0]!, { ...PURCHASES[2]!, seatFrom: 6 }];
    const v = verifyCargoProof(proof({ purchases: gap }));
    expect(v.sold).toBeNull();
    expect(v.checks.find((c) => c.key === 'seats')?.ok).toBe(false);
    expect(v.checks.find((c) => c.key === 'client')?.ok).toBe(false);
  });

  it('продано мест больше, чем в списке покупок', () => {
    expect(keys(proof({ seatsSold: 11, seatsTotal: 20 }))[1]).toBe('seats:false');
  });

  it('подменённый client seed раунда: место считается от списка покупок, а не от присланного', () => {
    expect(keys(proof({ clientSeed: sha256('forged') }))).toEqual([
      'hash:true',
      'seats:true',
      'client:false',
      'seat:true',
    ]);
  });

  it('записанное место не совпадает с пересчётом', () => {
    expect(keys(proof({ winningSeat: 4 }))[3]).toBe('seat:false');
    expect(keys(proof({ winningSeat: null }))[3]).toBe('seat:false');
  });

  it('server seed не раскрыт у закрытого раунда — хэш и место не проверить', () => {
    const v = verifyCargoProof(proof({ serverSeed: null, revealed: false }));
    expect(v.seat).toBeNull();
    expect(v.float).toBeNull();
    expect(v.checks.map((c) => `${c.key}:${c.ok}`)).toEqual([
      'hash:false',
      'seats:true',
      'client:true',
      'seat:false',
    ]);
  });

  it('закрыт по минимуму и отменён: место «выиграло бы» сверяется с voidSeat', () => {
    for (const status of ['expired', 'cancelled'] as const) {
      expect(keys(voided(status))).toEqual(['hash:true', 'seats:true', 'client:true', 'void:true']);
      expect(verifyCargoProof(voided(status)).seatOwner).toBe(0);
      expect(keys(voided(status, 5))[3]).toBe('void:false');
      expect(keys(voided(status, null))[3]).toBe('void:false');
    }
  });

  it('без продаж и отменённый до первой покупки — только хэш server seed', () => {
    expect(keys(empty('expired'))).toEqual(['hash:true']);
    expect(keys(empty('cancelled'))).toEqual(['hash:true']);
    expect(verifyCargoProof(empty('expired')).seat).toBeNull();
  });

  it('раунд идёт — проверок нет, только покупки и хэш', () => {
    const v = verifyCargoProof(
      proof({ status: 'open', revealed: false, serverSeed: null, clientSeed: null }),
    );
    expect(v).toMatchObject({ outcome: 'open', checks: [], seat: null, clientSeed: null });
  });
});

describe('проверка груза: начало строки для SHA-256', () => {
  it('до трёх покупок — строка целиком', () => {
    expect(cargoPreimageHead(PURCHASES)).toBe(PREIMAGE);
    expect(cargoPreimageHead(PURCHASES.slice(0, 1))).toBe('[[1,3,"aaaaaaaa"]]');
    expect(cargoPreimageHead([])).toBe('[]');
  });

  it('больше трёх — без закрывающей скобки и с многоточием', () => {
    const four = [...PURCHASES, { seatFrom: 11, seatTo: 11, clientSeed: 'dddddddd', mine: false }];
    const head = cargoPreimageHead(four);
    expect(head).toBe('[[1,3,"aaaaaaaa"],[4,4,"bbbbbbbb"],[5,10,"cccccccc"],…');
    // Это и правда начало полной строки.
    expect(JSON.stringify(four.map((p) => [p.seatFrom, p.seatTo, p.clientSeed]))).toContain(
      head.slice(0, -1),
    );
  });
});

describe('проверка груза: усечение списка покупок', () => {
  const rows = (r: CargoProofRow[]) =>
    r.map((x) => (x.kind === 'row' ? String(x.index) : `…${x.count}`)).join(' ');
  const none = { mine: [], pinned: [] };

  it('короткий список — целиком', () => {
    expect(rows(cargoProofRows(3, none))).toBe('0 1 2');
    expect(cargoProofRows(CARGO_PROOF_HEAD, none)).toHaveLength(CARGO_PROOF_HEAD);
    expect(cargoProofRows(0, none)).toEqual([]);
  });

  it('длинный — первые 200 и разрыв с числом скрытых', () => {
    const r = cargoProofRows(1000, none);
    expect(r).toHaveLength(201);
    expect(r[199]).toEqual({ kind: 'row', index: 199 });
    expect(r[200]).toEqual({ kind: 'gap', count: 800 });
  });

  it('свои и место победителя за пределами первых строк — по порядку мест, с разрывами', () => {
    expect(rows(cargoProofRows(12, { mine: [1, 6, 7, 7], pinned: [11] }, false, 4))).toBe(
      '0 1 2 3 …2 6 7 …3 11',
    );
    expect(rows(cargoProofRows(12, { mine: [4], pinned: [9] }, false, 4))).toBe(
      '0 1 2 3 4 …4 9 …2',
    );
    // Чужие индексы (за концом списка, дробные, отрицательные) не ломают список.
    expect(rows(cargoProofRows(6, { mine: [-1, 2.5, 6, 40], pinned: [5] }, false, 4))).toBe(
      '0 1 2 3 …1 5',
    );
  });

  it('своих покупок за первыми строками — не больше 200, закреплённые — всегда', () => {
    const mine = Array.from({ length: 800 }, (_, i) => 999 - i); // 200…999, в обратном порядке
    const r = cargoProofRows(1000, { mine, pinned: [998] });
    const shown = r.filter((x) => x.kind === 'row').map((x) => (x as { index: number }).index);
    expect(shown).toHaveLength(401);
    expect(shown.slice(195, 205)).toEqual([195, 196, 197, 198, 199, 200, 201, 202, 203, 204]);
    expect(shown.at(-2)).toBe(399);
    expect(shown.at(-1)).toBe(998);
    expect(r.filter((x) => x.kind === 'gap')).toEqual([
      { kind: 'gap', count: 598 },
      { kind: 'gap', count: 1 },
    ]);
  });

  it('«Показать все» — каждая покупка, без разрывов', () => {
    const r = cargoProofRows(10_000, { mine: [9_999], pinned: [5_000] }, true);
    expect(r).toHaveLength(10_000);
    expect(r.every((x, i) => x.kind === 'row' && x.index === i)).toBe(true);
  });
});

describe('проверка груза: тексты', () => {
  const t = createTranslator({ locale: 'ru', messages: ru, namespace: 'fair' });
  // Числа — строками formatGems, как «Доступно мест 1450/10 000» на странице груза.
  const skipped = (count: number) => t('cargoSkipped', { count, n: formatGems(count) });

  it('формы числа скрытых покупок', () => {
    expect(skipped(1)).toBe('скрыта 1 покупка');
    expect(skipped(21)).toBe('скрыта 21 покупка');
    expect(skipped(3)).toBe('скрыты 3 покупки');
    expect(skipped(5)).toBe('скрыто 5 покупок');
    expect(skipped(1234)).toBe('скрыты 1234 покупки');
    expect(skipped(9800)).toBe('скрыто 9800 покупок');
    expect(skipped(10_000)).toBe(`скрыто ${formatGems(10_000)} покупок`);
  });

  it('места, кнопка списка и итоги', () => {
    expect(t('cargoPurchase', { from: 1, to: 3 })).toBe('№1–3');
    expect(t('cargoSeat', { seat: 4 })).toBe('№4');
    expect(t('cargoShowAll', { count: formatGems(10_000) })).toBe(
      `Показать все покупки (${formatGems(10_000)})`,
    );
    expect(formatGems(10_000)).toMatch(/^10\s000$/);
    expect(t('cargoSold', { sold: formatGems(1450), total: formatGems(10_000) })).toBe(
      `Продано мест: 1450 из ${formatGems(10_000)}`,
    );
    expect(t('cargoWinningSeat', { seat: 3, sold: 10 })).toBe(
      'Выигравшее место по пересчёту: №3 из 10',
    );
    expect(t('cargoVoidSeat', { seat: 1, sold: 2 })).toBe(
      'При приземлении выиграло бы место №1 из 2',
    );
    expect(t('cargoMinSeats', { min: 4 })).toBe(
      'Мест купили меньше минимума (4) — розыгрыш не состоялся, гемы вернулись',
    );
    expect(t('cargoRecordedSeat', { seat: 187 })).toBe('на сайте записано №187');
    expect(t('cargoSkipped', { count: 0, n: '0' })).toBe('скрыто 0 покупок');
    expect(t('kinds.cargo')).toBe('Груз');
  });

  it('how5 описывает ту же строку, что считает game-core', () => {
    expect(t('how5')).toContain('JSON.stringify([[от, до, "client seed"], …])');
    expect(t('how5')).toContain('floor(float × проданных мест) + 1');
  });
});
