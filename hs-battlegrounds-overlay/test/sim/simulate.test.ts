/** Monte Carlo driver: determinism, probabilities, robustness, performance, worker protocol. */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, MinionSnapshot } from '@shared/types';
import { simulateBattle } from '../../src/core/sim';
import type { SimWorkerRequest, SimWorkerResponse } from '../../src/core/sim';
import { battle, minion, side, vanilla } from './helpers';

/** A 7-minion board full of deathrattles and summons. */
function deathrattleBoard(): MinionSnapshot[] {
  return [
    minion('BG28_300', { attack: 4, health: 4 }), // Harmless Bonehead
    minion('BG30_125', { attack: 6, health: 6 }), // Cadaver Caretaker
    minion('BG31_803', { attack: 3, health: 5 }), // Buzzing Vermin
    minion('BGS_018'), // Goldrinn
    minion('BG25_010', { attack: 5, health: 4 }), // Handless Forsaken
    minion('BG_BOT_606', { attack: 4, health: 4 }), // Kaboom Bot
    minion('BG35_604'), // Sewer Lord
  ];
}

function mirrorInput(): BattleSimInput {
  return battle(side(deathrattleBoard(), { tavernTier: 5 }), side(deathrattleBoard(), { tavernTier: 5 }));
}

describe('simulateBattle', () => {
  it('is deterministic for a given seed', () => {
    const a = simulateBattle(mirrorInput(), { iterations: 500, seed: 123, maxDurationMs: 60_000 });
    const b = simulateBattle(mirrorInput(), { iterations: 500, seed: 123, maxDurationMs: 60_000 });
    expect({ ...a, durationMs: 0 }).toEqual({ ...b, durationMs: 0 });
    const c = simulateBattle(mirrorInput(), { iterations: 500, seed: 124, maxDurationMs: 60_000 });
    expect(c.win).not.toBe(a.win);
  });

  it('percentages add up to 100 and the distribution to 1', () => {
    const r = simulateBattle(mirrorInput(), { iterations: 1000, seed: 5, maxDurationMs: 60_000 });
    expect(r.iterations).toBe(1000);
    expect(r.win + r.tie + r.loss).toBeCloseTo(100, 6);
    const total = Object.values(r.damageDistribution!).reduce((a, x) => a + x, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('symmetric boards are close to 50/50', () => {
    const r = simulateBattle(mirrorInput(), { iterations: 4000, seed: 99, maxDurationMs: 60_000 });
    expect(Math.abs(r.win - r.loss)).toBeLessThan(5);
    expect(Math.abs(r.avgDamageDealt - r.avgDamageTaken)).toBeLessThan(1);

    const plain = () => side([vanilla(3, 4), vanilla(2, 6, { taunt: true }), vanilla(5, 2), vanilla(1, 7, { divineShield: true })]);
    const r2 = simulateBattle(battle(plain(), plain()), { iterations: 4000, seed: 3, maxDurationMs: 60_000 });
    expect(Math.abs(r2.win - r2.loss)).toBeLessThan(5);
  });

  it('a stronger board wins most of the time', () => {
    const weak = side([vanilla(2, 2), vanilla(2, 2), vanilla(2, 2)]);
    const strong = side([vanilla(3, 3), vanilla(3, 3), vanilla(3, 3)]);
    const r = simulateBattle(battle(strong, weak), { iterations: 1000, seed: 1, maxDurationMs: 60_000 });
    expect(r.win).toBeGreaterThan(90);
  });

  it('stops at maxDurationMs', () => {
    const r = simulateBattle(mirrorInput(), { iterations: 10_000_000, seed: 1, maxDurationMs: 50 });
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.iterations).toBeLessThan(10_000_000);
    expect(r.durationMs).toBeLessThan(500);
  });

  it('never throws on unknown cards or sparse input', () => {
    const odd = {
      ...vanilla(3, 3),
      cardId: 'NOT_A_REAL_CARD',
      tribes: [],
      keywords: {},
      enchantments: [{ entityId: 5, cardId: 'ALSO_NOT_REAL' }],
      tags: {},
    } as MinionSnapshot;
    const sparse = { minions: [odd], hand: [], trinkets: [{ cardId: 'NOPE' }], questRewards: ['NOPE2'] } as never;
    const input = {
      turn: 3,
      player: { ...side([]), ...(sparse as object) },
      opponent: side([vanilla(1, 1)], { heroPowerCardId: 'UNKNOWN_HP' }),
      availableTribes: [],
      mode: 'solo',
      anomalyCardId: 'UNKNOWN_ANOMALY',
    } as BattleSimInput;
    const r = simulateBattle(input, { iterations: 50, seed: 1 });
    expect(r.win).toBe(100);
  });

  it('runs 4000 iterations of two 7-minion deathrattle boards in under 1.5 s', () => {
    simulateBattle(mirrorInput(), { iterations: 200, seed: 1 }); // warm-up (JIT)
    const t0 = performance.now();
    const r = simulateBattle(mirrorInput(), { iterations: 4000, seed: 2, maxDurationMs: 60_000 });
    const elapsed = performance.now() - t0;
    expect(r.iterations).toBe(4000);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('worker', () => {
  it('answers { id, result } and { id, error }', async () => {
    const posted: SimWorkerResponse[] = [];
    const g = globalThis as unknown as {
      postMessage?: (m: SimWorkerResponse) => void;
      onmessage?: ((ev: { data: SimWorkerRequest }) => void) | null;
    };
    const prevPost = g.postMessage;
    const prevOn = g.onmessage;
    g.postMessage = (m) => posted.push(m);
    try {
      await import('../../src/core/sim/worker');
      const input = battle(side([vanilla(3, 3)]), side([vanilla(1, 1)]));
      g.onmessage!({ data: { id: 7, input, options: { iterations: 20, seed: 1 } } });
      expect(posted[0].id).toBe(7);
      expect('result' in posted[0] && posted[0].result.win).toBe(100);
      g.onmessage!({ data: { id: 8, input: undefined as unknown as BattleSimInput } });
      expect(posted[1].id).toBe(8);
      expect('error' in posted[1] || 'result' in posted[1]).toBe(true);
    } finally {
      g.postMessage = prevPost;
      g.onmessage = prevOn;
    }
  });
});
