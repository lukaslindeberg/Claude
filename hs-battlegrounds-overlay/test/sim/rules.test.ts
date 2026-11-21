/** Core combat rules, tested on vanilla minions and the engine primitives. */
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '../../src/core/sim';
import { registerMinion } from '../../src/core/sim/cards';
import { buff } from '../../src/core/sim/engine/actions';
import { pickTarget, takeTurn } from '../../src/core/sim/engine/attack';
import { createBattle, runBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { Rng } from '../../src/core/sim/engine/rng';
import { ensureCardsRegistered } from '../../src/core/sim/cards';
import type { BattleSimInput } from '@shared/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const RUNS = { iterations: 300, seed: 42, maxDurationMs: 60_000 };

function newBattle(input: BattleSimInput, seed = 1) {
  return createBattle(input, db, new Rng(seed));
}

describe('basic trades', () => {
  it('a bigger minion always wins a 1v1', () => {
    const r = simulateBattle(battle(side([vanilla(3, 3)]), side([vanilla(2, 2)])), RUNS);
    expect(r.win).toBe(100);
    expect(r.avgDamageDealt).toBe(2); // tavern tier 1 + one tier-1 survivor
  });

  it('mutual kill is a tie', () => {
    const r = simulateBattle(battle(side([vanilla(1, 1)]), side([vanilla(1, 1)])), RUNS);
    expect(r.tie).toBe(100);
    expect(r.damageDistribution).toEqual({ '0': 1 });
  });

  it('both boards empty is a tie', () => {
    const r = simulateBattle(battle(side([]), side([])), RUNS);
    expect(r.tie).toBe(100);
  });

  it('an empty board loses to any board', () => {
    const r = simulateBattle(battle(side([]), side([vanilla(1, 1)])), RUNS);
    expect(r.loss).toBe(100);
  });

  it('two 0-Attack boards are a stalemate tie', () => {
    const r = simulateBattle(battle(side([vanilla(0, 5)]), side([vanilla(0, 5)])), RUNS);
    expect(r.tie).toBe(100);
  });

  it('a side that cannot attack still loses to one that can', () => {
    const r = simulateBattle(battle(side([vanilla(0, 5)]), side([vanilla(1, 10)])), RUNS);
    expect(r.loss).toBe(100);
  });

  it('the side with more minions attacks first', () => {
    const b = newBattle(battle(side([vanilla(1, 5)]), side([vanilla(1, 5), vanilla(1, 5)])));
    b.log = [];
    runBattle(b);
    expect(b.log[0]).toMatch(/^attack O:/);
  });

  it('first attacker is random when minion counts are equal', () => {
    let playerFirst = 0;
    for (let s = 1; s <= 200; s++) {
      const b = newBattle(battle(side([vanilla(1, 5)]), side([vanilla(1, 5)])), s);
      b.log = [];
      runBattle(b);
      if (b.log[0].startsWith('attack P:')) playerFirst++;
    }
    expect(playerFirst).toBeGreaterThan(70);
    expect(playerFirst).toBeLessThan(130);
  });

  it('attackers go left to right and wrap around', () => {
    const p = side([minion('A', { attack: 1, health: 50 }), minion('B', { attack: 1, health: 50 }), minion('C', { attack: 1, health: 50 })]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.log = [];
    for (let i = 0; i < 4; i++) takeTurn(b, b.sides[0]);
    const names = b.log.filter((l) => l.startsWith('attack')).map((l) => l.slice(9, 10));
    expect(names).toEqual(['A', 'B', 'C', 'A']);
  });

  it('0-Attack minions are skipped in the attack order', () => {
    const p = side([minion('A', { attack: 1, health: 50 }), minion('Z', { attack: 0, health: 50 }), minion('C', { attack: 1, health: 50 })]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.log = [];
    for (let i = 0; i < 3; i++) takeTurn(b, b.sides[0]);
    const names = b.log.filter((l) => l.startsWith('attack')).map((l) => l.slice(9, 10));
    expect(names).toEqual(['A', 'C', 'A']);
  });
});

describe('targeting', () => {
  it('attacks only Taunt minions while any are alive', () => {
    const opp = side([vanilla(1, 5), vanilla(1, 5, { taunt: true }), vanilla(1, 5)]);
    const b = newBattle(battle(side([vanilla(1, 1)]), opp));
    const taunt = b.sides[1].board[1];
    for (let i = 0; i < 200; i++) expect(pickTarget(b, b.sides[1])).toBe(taunt);
  });

  it('picks uniformly among non-Taunt minions and never a Stealth one', () => {
    const opp = side([vanilla(1, 5), vanilla(1, 5, { stealth: true }), vanilla(1, 5)]);
    const b = newBattle(battle(side([vanilla(1, 1)]), opp));
    const counts = new Map<number, number>();
    for (let i = 0; i < 2000; i++) {
      const t = pickTarget(b, b.sides[1])!;
      counts.set(t.entityId, (counts.get(t.entityId) ?? 0) + 1);
    }
    expect(counts.has(b.sides[1].board[1].entityId)).toBe(false);
    for (const v of counts.values()) expect(v).toBeGreaterThan(850);
  });
});

describe('keywords', () => {
  it('Divine Shield absorbs one hit', () => {
    const r = simulateBattle(battle(side([vanilla(1, 1, { divineShield: true })]), side([vanilla(1, 1)])), RUNS);
    expect(r.win).toBe(100);
  });

  it('Venomous destroys the target and is consumed', () => {
    // 1/2 venomous kills a 1/100 at once.
    expect(simulateBattle(battle(side([vanilla(1, 2, { venomous: true })]), side([vanilla(1, 100)])), RUNS).win).toBe(100);
    // Venom used on the first 1/100; the second outlasts the 1/10.
    const two = side([vanilla(1, 100), vanilla(1, 100)]);
    expect(simulateBattle(battle(side([vanilla(1, 10, { venomous: true })]), two), RUNS).loss).toBe(100);
    // Poisonous is permanent.
    const two2 = side([vanilla(1, 100), vanilla(1, 100)]);
    expect(simulateBattle(battle(side([vanilla(1, 10, { poisonous: true })]), two2), RUNS).win).toBe(100);
  });

  it('Venomous is not consumed by a Divine Shield', () => {
    const opp = side([vanilla(0, 100, { divineShield: true, taunt: true }), vanilla(0, 100)]);
    const b = newBattle(battle(side([vanilla(1, 10, { venomous: true })]), opp));
    takeTurn(b, b.sides[0]);
    expect(b.sides[0].board[0].venomous).toBe(true);
    takeTurn(b, b.sides[0]);
    expect(b.sides[1].board.length).toBe(1);
    expect(b.sides[0].board[0].venomous).toBe(false);
  });

  it('Windfury attacks twice, Mega-Windfury four times per turn', () => {
    for (const [kw, expected] of [[{}, 1], [{ windfury: true }, 2], [{ megaWindfury: true }, 4]] as const) {
      const b = newBattle(battle(side([vanilla(1, 100, kw)]), side([vanilla(0, 100)])));
      takeTurn(b, b.sides[0]);
      expect(b.attacks).toBe(expected);
    }
  });

  it('Cleave also hits the neighbours of the target', () => {
    const opp = side([vanilla(0, 1), vanilla(0, 1, { taunt: true }), vanilla(0, 1), vanilla(0, 1)]);
    const b = newBattle(battle(side([vanilla(5, 50, { cleave: true })]), opp));
    takeTurn(b, b.sides[0]);
    expect(b.sides[1].board.length).toBe(1);
  });

  it('Reborn comes back once with 1 Health', () => {
    const r = simulateBattle(battle(side([minion('BG25_001')]), side([vanilla(2, 1)])), RUNS); // Risen Rider 2/1
    expect(r.win).toBe(100);
    const b = newBattle(battle(side([minion('BG25_001')]), side([vanilla(0, 100)])));
    const rider = b.sides[0].board[0];
    rider.health = 0;
    resolveDeaths(b);
    const reborn = b.sides[0].board[0];
    expect(reborn).not.toBe(rider);
    expect(reborn.cardId).toBe('BG25_001');
    expect(reborn.health).toBe(1);
    expect(reborn.reborn).toBe(false);
    expect(reborn.taunt).toBe(true);
  });
});

describe('deaths and summons', () => {
  it('deathrattle summons take the dead minion slot', () => {
    const p = side([vanilla(1, 5), minion('BG28_300'), vanilla(2, 5)]); // Harmless Bonehead in the middle
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.sides[0].board[1].health = 0;
    resolveDeaths(b);
    const names = b.sides[0].board.map((m) => m.name);
    expect(names).toEqual(['TEST_VANILLA', 'Skeleton', 'Skeleton', 'TEST_VANILLA']);
  });

  it('summons stop at 7 minions', () => {
    const p = side([vanilla(1, 5), vanilla(1, 5), minion('BG28_300'), vanilla(1, 5), vanilla(1, 5), vanilla(1, 5), vanilla(1, 5)]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.sides[0].board[2].health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.length).toBe(7);
    expect(b.sides[0].board.filter((m) => m.name === 'Skeleton').length).toBe(1);
    expect(b.sides[0].board[2].name).toBe('Skeleton');
  });

  it('tokens of an attacker that died attack next', () => {
    const p = side([minion('BG28_300', { attack: 1, health: 1 }), minion('B', { attack: 1, health: 50 })]);
    const b = newBattle(battle(p, side([vanilla(5, 100)])));
    b.log = [];
    takeTurn(b, b.sides[0]); // Bonehead attacks and dies -> two Skeletons
    takeTurn(b, b.sides[0]);
    const attacks = b.log.filter((l) => l.startsWith('attack'));
    expect(attacks[0]).toMatch(/Harmless Bonehead/);
    expect(attacks[1]).toMatch(/Skeleton/);
  });

  it('minions summoned left of the next attacker wait for the next cycle', () => {
    const p = side([minion('BG28_300', { attack: 0, health: 1 }), minion('B', { attack: 1, health: 50 }), minion('C', { attack: 1, health: 50 })]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.log = [];
    takeTurn(b, b.sides[0]); // B attacks (Bonehead has 0 Attack)
    b.sides[0].board[0].health = 0; // Bonehead dies outside its turn
    resolveDeaths(b);
    takeTurn(b, b.sides[0]);
    const attacks = b.log.filter((l) => l.startsWith('attack')).map((l) => l.slice(9, 10));
    expect(attacks).toEqual(['B', 'C']);
  });

  it('Avenge triggers after N friendly deaths and resets', () => {
    registerMinion('TEST_AVENGER', { avenge: 2, onAvenge: (bb, self) => buff(bb, self, 1, 1) });
    const p = side([minion('TEST_AVENGER', { attack: 0, health: 10 }), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1)]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    for (const m of b.sides[0].board.slice(1)) m.health = 0;
    resolveDeaths(b);
    const avenger = b.sides[0].board[0];
    expect(avenger.attack).toBe(2); // 5 deaths -> triggered twice
    expect(avenger.avengeProgress).toBe(1);
  });

  it('Start of Combat effects resolve before attacks (Boom-in-a-Box)', () => {
    const r = simulateBattle(
      battle(side([minion('BG36_620')]), side([vanilla(9, 3), vanilla(9, 3), vanilla(9, 3)])),
      RUNS,
    );
    expect(r.win).toBe(100);
  });
});

describe('auras', () => {
  registerMinion('TEST_WARLEADER', {
    aura: (_b, self, target) => (target !== self && target.side === self.side ? { attack: 2, health: 1 } : null),
  });

  it('snapshot stats are not double counted, summons gain the aura, death removes it', () => {
    // Snapshot of a 1/1 under the aura is 3/2.
    const p = side([minion('TEST_WARLEADER', { attack: 1, health: 1 }), minion('BG28_300', { attack: 3, health: 2 })]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    const [leader, bonehead] = b.sides[0].board;
    expect([bonehead.attack, bonehead.health]).toEqual([3, 2]);
    bonehead.health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.slice(1).map((m) => [m.attack, m.health])).toEqual([
      [3, 2],
      [3, 2],
    ]);
    leader.health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.map((m) => [m.attack, m.health])).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });
});

describe('damage', () => {
  it('is the tavern tier plus the tiers of surviving minions', () => {
    const p = side([vanilla(5, 5, {}, 3), vanilla(5, 5, {}, 5)], { tavernTier: 4 });
    const r = simulateBattle(battle(p, side([])), RUNS);
    expect(r.win).toBe(100);
    expect(r.avgDamageDealt).toBe(12);
    expect(r.damageDistribution).toEqual({ '12': 1 });
  });

  it('tokens without a tier count as 1 and the damage cap applies', () => {
    const p = side([minion('TOKEN', { attack: 5, health: 5, tier: undefined })], { tavernTier: 6 });
    expect(simulateBattle(battle(p, side([])), RUNS).avgDamageDealt).toBe(7);
    const p2 = side([vanilla(5, 5, {}, 6), vanilla(5, 5, {}, 6)], { tavernTier: 6 });
    expect(simulateBattle(battle(p2, side([]), { damageCap: 5 }), RUNS).avgDamageDealt).toBe(5);
  });

  it('reports lethal using health plus armor', () => {
    const p = side([vanilla(5, 5, {}, 6)], { tavernTier: 6 });
    expect(simulateBattle(battle(p, side([], { health: 5, armor: 2 })), RUNS).lethalWin).toBe(100);
    expect(simulateBattle(battle(p, side([], { health: 10, armor: 3 })), RUNS).lethalWin).toBe(0);
    const o = side([vanilla(5, 5, {}, 6)], { tavernTier: 6 });
    expect(simulateBattle(battle(side([], { health: 3 }), o), RUNS).lethalLoss).toBe(100);
  });
});
