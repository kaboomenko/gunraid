import { describe, expect, it } from 'vitest';
import {
  battleClientSeed,
  battleRecipient,
  battleRoll,
  battleSlots,
  battleTeamOf,
  battleTiebreak,
  resolveBattle,
} from './index.js';

describe('battle', () => {
  it('slots and teams', () => {
    expect(battleSlots('1v1')).toBe(2);
    expect(battleSlots('1v1v1')).toBe(3);
    expect(battleSlots('2v2')).toBe(4);
    expect([0, 1, 2, 3].map((s) => battleTeamOf('2v2', s))).toEqual([0, 0, 1, 1]);
    expect(battleTeamOf('1v1v1v1', 3)).toBeNull();
  });

  it('classic — max total wins, crazy — min total wins', () => {
    expect(resolveBattle('1v1v1', 'classic', [100, 300, 200], 0.5).winnerSlots).toEqual([1]);
    expect(resolveBattle('1v1v1', 'crazy', [100, 300, 200], 0.5).winnerSlots).toEqual([0]);
  });

  it('ties are resolved by the tiebreak roll among candidates', () => {
    const low = resolveBattle('1v1v1v1', 'classic', [50, 300, 10, 300], 0.1);
    const high = resolveBattle('1v1v1v1', 'classic', [50, 300, 10, 300], 0.9);
    expect(low.tie).toBe(true);
    expect(low.candidates).toEqual([1, 3]);
    expect(low.winnerSlots).toEqual([1]);
    expect(high.winnerSlots).toEqual([3]);
  });

  it('2v2 — team totals, paired drops go to the winners', () => {
    const r = resolveBattle('2v2', 'classic', [100, 100, 150, 10], 0.5);
    expect(r.winnerTeam).toBe(0);
    expect(r.winnerSlots).toEqual([0, 1]);
    expect([0, 1, 2, 3].map((s) => battleRecipient('2v2', r.winnerSlots, s))).toEqual([0, 1, 0, 1]);
    const r2 = resolveBattle('2v2', 'crazy', [100, 100, 150, 10], 0.5);
    expect(r2.winnerSlots).toEqual([2, 3]);
    expect([0, 1, 2, 3].map((s) => battleRecipient('2v2', r2.winnerSlots, s))).toEqual([
      2, 3, 2, 3,
    ]);
  });

  it('winner takes all in free-for-all', () => {
    expect([0, 1, 2].map((s) => battleRecipient('1v1v1', [2], s))).toEqual([2, 2, 2]);
  });

  it('rolls are deterministic per round and slot', () => {
    const seed = 'a'.repeat(64);
    const client = battleClientSeed(['s0', 's1']);
    expect(client).toMatch(/^[0-9a-f]{64}$/);
    const a = battleRoll(seed, client, 0, 0);
    expect(battleRoll(seed, client, 0, 0)).toBe(a);
    expect(battleRoll(seed, client, 0, 1)).not.toBe(a);
    expect(battleRoll(seed, client, 1, 0)).not.toBe(a);
    const t = battleTiebreak(seed, client);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1);
  });
});
