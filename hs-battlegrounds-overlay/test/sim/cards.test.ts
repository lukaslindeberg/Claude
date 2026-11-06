/** Real-card handler tests (card ids from the bundled patch data). */
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '../../src/core/sim';
import { ensureCardsRegistered, getMinionHandler } from '../../src/core/sim/cards';
import { takeTurn } from '../../src/core/sim/engine/attack';
import { createBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { Rng } from '../../src/core/sim/engine/rng';
import { startOfCombat } from '../../src/core/sim/engine/startOfCombat';
import type { BattleSimInput } from '@shared/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const RUNS = { iterations: 300, seed: 7, maxDurationMs: 60_000 };

function newBattle(input: BattleSimInput, seed = 1) {
  return createBattle(input, db, new Rng(seed));
}

/** Kill the minion at `index` of the player's board and resolve deaths. */
function kill(input: BattleSimInput, index: number, seed = 1) {
  const b = newBattle(input, seed);
  b.sides[0].board[index].health = 0;
  resolveDeaths(b);
  return b;
}

const dummy = () => side([vanilla(0, 1000)]);

describe('deathrattles', () => {
  it('Harmless Bonehead: two Skeletons, four when golden', () => {
    expect(kill(battle(side([minion('BG28_300')]), dummy()), 0).sides[0].board.map((m) => m.cardId)).toEqual([
      'BG_ICC_026t',
      'BG_ICC_026t',
    ]);
    expect(kill(battle(side([minion('BG28_300', { golden: true })]), dummy()), 0).sides[0].board.length).toBe(4);
  });

  it('Titus Rivendare triggers deathrattles an extra time (golden: 2 extra)', () => {
    const b = kill(battle(side([minion('BG28_300'), minion('BG25_354')]), dummy()), 0);
    expect(b.sides[0].board.filter((m) => m.name === 'Skeleton').length).toBe(4);
    const g = kill(battle(side([minion('BG28_300'), minion('BG25_354', { golden: true })]), dummy()), 0);
    expect(g.sides[0].board.filter((m) => m.name === 'Skeleton').length).toBe(6);
  });

  it('Cord Puller summons a 1/1 Microbot (golden: 2/2)', () => {
    const b = kill(battle(side([minion('BG29_611')]), dummy()), 0);
    expect(b.sides[0].board.map((m) => [m.name, m.attack, m.health])).toEqual([['Microbot', 1, 1]]);
    const g = kill(battle(side([minion('BG29_611', { golden: true })]), dummy()), 0);
    expect(g.sides[0].board.map((m) => [m.attack, m.health])).toEqual([[2, 2]]);
  });

  it('Goldrinn buffs current and later-summoned Beasts', () => {
    const b = kill(battle(side([minion('BGS_018'), minion('BG31_803'), vanilla(1, 1)]), dummy()), 0);
    const [vermin, other] = b.sides[0].board;
    expect([vermin.attack, vermin.health]).toEqual([8, 8]);
    expect([other.attack, other.health]).toEqual([1, 1]);
    vermin.health = 0;
    resolveDeaths(b);
    const beetle = b.sides[0].board[0];
    expect(beetle.name).toBe('Beetle');
    expect([beetle.attack, beetle.health]).toEqual([9, 9]);
  });

  it('Leeroy destroys the minion that killed it', () => {
    const b = newBattle(battle(side([minion('BG23_318')]), side([vanilla(10, 100)])));
    takeTurn(b, b.sides[0]);
    expect(b.sides[0].board.length).toBe(0);
    expect(b.sides[1].board.length).toBe(0);
  });

  it('Kaboom Bot deals 4 damage to a random enemy', () => {
    const b = kill(battle(side([minion('BG_BOT_606')]), side([vanilla(0, 10)])), 0);
    expect(b.sides[1].board[0].health).toBe(6);
  });

  it('Ghastcoiler summons two random Deathrattle minions', () => {
    for (let s = 1; s <= 20; s++) {
      const b = kill(battle(side([minion('BGS_008')]), dummy(), { availableTribes: ['BEAST', 'UNDEAD', 'MECHANICAL', 'DEMON', 'MURLOC'] }), 0, s);
      expect(b.sides[0].board.length).toBe(2);
      for (const m of b.sides[0].board) {
        expect(db.get(m.cardId)?.mechanics).toContain('DEATHRATTLE');
        expect(m.cardId).not.toBe('BGS_008');
      }
    }
  });

  it('Underrot Spawn summons a Tentacle and gives your minions +1 Attack', () => {
    const b = kill(battle(side([vanilla(1, 1), minion('BG36_116')]), dummy()), 1);
    expect(b.sides[0].board.map((m) => [m.name, m.attack])).toEqual([
      ['TEST_VANILLA', 2],
      ['Aberrant Tentacle', 1],
    ]);
    expect(b.sides[0].board[1].taunt).toBe(true);
  });

  it('Sewer Lord chains into Sewer Rats and Turtles', () => {
    const b = kill(battle(side([minion('BG35_604')]), dummy()), 0);
    expect(b.sides[0].board.map((m) => m.name)).toEqual(['Sewer Rat', 'Sewer Rat']);
    b.sides[0].board[0].health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.map((m) => m.name)).toEqual(['Half-Shell', 'Sewer Rat']);
  });

  it('Scallywag summons a Pirate that attacks immediately', () => {
    const b = newBattle(battle(side([minion('BGS_061')]), side([vanilla(0, 1), vanilla(0, 50, { taunt: true })])));
    b.sides[0].board[0].health = 0;
    b.log = [];
    resolveDeaths(b);
    expect(b.log.some((l) => /attack P:Sky Pirate.*\(immediate\)/.test(l))).toBe(true);
  });

  it('Fish of N\'Zoth gains deathrattles of friendly minions that die', () => {
    const b = kill(battle(side([minion('BG28_300'), minion('TB_BaconShop_HP_105t')]), dummy()), 0);
    const fish = b.sides[0].board.find((m) => m.name === "Fish of N'Zoth")!;
    expect(fish.extraDeathrattles.length).toBe(1);
    fish.health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.filter((m) => m.name === 'Skeleton').length).toBe(4);
  });
});

describe('avenge, attack and summon triggers', () => {
  it('Eternal Tycoon summons an Eternal Knight that attacks immediately after 5 deaths', () => {
    const p = side([minion('BG34_403'), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1)]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.log = [];
    for (const m of b.sides[0].board.slice(1)) m.health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.map((m) => m.name)).toEqual(['Eternal Tycoon', 'Eternal Knight']);
    expect(b.log.some((l) => /attack P:Eternal Knight.*\(immediate\)/.test(l))).toBe(true);
  });

  it('Rot Hide Gnoll gains +1 Attack per friendly death', () => {
    const b = kill(battle(side([minion('BG25_013'), vanilla(1, 1)]), dummy()), 1);
    expect(b.sides[0].board[0].attack).toBe(2);
  });

  it('Wildfire Elemental deals excess damage to an adjacent enemy', () => {
    const opp = side([vanilla(0, 10), vanilla(0, 2, { taunt: true }), vanilla(0, 10)]);
    const b = newBattle(battle(side([minion('BGS_126')]), opp)); // 6/3
    takeTurn(b, b.sides[0]);
    const hp = b.sides[1].board.map((m) => m.health).sort((x, y) => x - y);
    expect(hp).toEqual([6, 10]);
  });

  it('Prodigious Tusker plays a Blood Gem on other attackers', () => {
    const p = side([vanilla(1, 10), minion('BG33_430', { attack: 0 })], { playerTags: { BACON_BLOODGEMBUFFATKVALUE: 2 } });
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    takeTurn(b, b.sides[0]);
    const attacker = b.sides[0].board[0];
    expect([attacker.attack, attacker.health]).toEqual([4, 11]);
  });

  it('Cage Gnawer buffs Beasts whenever a friendly Beast attacks (including itself)', () => {
    const p = side([minion('BG36_211'), minion('BG31_803', { attack: 0 })]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    takeTurn(b, b.sides[0]);
    expect(b.sides[0].board.map((m) => m.attack)).toEqual([4, 2]);
  });

  it('Stalwart Kodo gives summoned minions double its stats, 3 times per combat', () => {
    const p = side([minion('BG34_322'), minion('BG30_125')]); // Cadaver Caretaker: three Skeletons
    const b = kill(battle(p, dummy()), 1);
    const skeletons = b.sides[0].board.filter((m) => m.name === 'Skeleton');
    expect(skeletons.map((m) => m.attack)).toEqual([31, 31, 31]);
    b.sides[0].board[1].health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.filter((m) => m.name === 'Skeleton').length).toBe(2);
  });

  it('Banana Slamma doubles the Attack of summoned Beasts', () => {
    const b = kill(battle(side([minion('BG26_802'), minion('BG31_803')]), dummy()), 1);
    expect(b.sides[0].board[1].attack).toBe(4); // 2/2 Beetle -> 4/2
  });

  it('Relentless Deflector has Taunt only while it has Divine Shield', () => {
    const p = side([minion('BG34_405', { keywords: { divineShield: true } })]);
    const b = newBattle(battle(p, side([vanilla(1, 100)])));
    const d = b.sides[0].board[0];
    expect(d.taunt).toBe(true);
    takeTurn(b, b.sides[1]);
    expect(d.divineShield).toBe(false);
    expect(d.taunt).toBe(false);
  });

  it('Bile Spitter gives another Murloc Venomous on attack', () => {
    const p = side([minion('BG33_318'), minion('BG31_149', { attack: 0 })]);
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    takeTurn(b, b.sides[0]);
    expect(b.sides[0].board[1].venomous).toBe(true);
  });
});

describe('start of combat', () => {
  it('Amber Guardian gives another Dragon +2/+2 and Divine Shield', () => {
    const b = newBattle(battle(side([minion('BG24_500'), minion('BG26_963')]), dummy()));
    startOfCombat(b);
    const synth = b.sides[0].board[1];
    // +2/+2 from Amber Guardian, Synthesizer itself is not buffed by its own effect.
    expect([synth.attack, synth.health, synth.divineShield]).toEqual([5, 6, true]);
    // Synthesizer gave Amber Guardian +1/+1.
    expect([b.sides[0].board[0].attack, b.sides[0].board[0].health]).toEqual([4, 3]);
  });

  it('Stitched Salvager destroys the minion to its left and resummons a copy on death', () => {
    const p = side([minion('BG28_300'), minion('BG31_999')]);
    const b = newBattle(battle(p, dummy()));
    startOfCombat(b);
    // Bonehead destroyed: two Skeletons.
    expect(b.sides[0].board.map((m) => m.name)).toEqual(['Skeleton', 'Skeleton', 'Stitched Salvager']);
    b.sides[0].board[2].health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.map((m) => m.name)).toEqual(['Skeleton', 'Skeleton', 'Harmless Bonehead']);
  });

  it('hero power: Nefarious Fire deals 1 damage to all enemy minions', () => {
    const p = side([vanilla(1, 1)], { heroPowerCardId: 'TB_BaconShop_HP_043' });
    const b = newBattle(battle(p, side([vanilla(1, 1), vanilla(1, 2)])));
    startOfCombat(b);
    expect(b.sides[1].board.map((m) => m.health)).toEqual([1]);
  });

  it('hero power: Wingmen buffs the outer minions and they attack immediately', () => {
    const p = side([vanilla(1, 5), vanilla(1, 5), vanilla(1, 5)], { heroPowerCardId: 'TB_BaconShop_HP_069' });
    const b = newBattle(battle(p, side([vanilla(0, 100)])));
    b.log = [];
    startOfCombat(b);
    expect(b.log.filter((l) => l.includes('(immediate)')).length).toBe(2);
    expect(b.sides[0].board.map((m) => m.attack)).toEqual([3, 1, 3]);
  });

  it('trinket: Valorous Medallion gives +2/+2', () => {
    const p = side([vanilla(1, 1)], { trinkets: [{ cardId: 'BG30_MagicItem_970' }] });
    const b = newBattle(battle(p, dummy()));
    startOfCombat(b);
    expect([b.sides[0].board[0].attack, b.sides[0].board[0].health]).toEqual([3, 3]);
  });

  it('enchantment: Earth Invocation deathrattle on a snapshot minion', () => {
    const b = kill(battle(side([vanilla(1, 1)].map((m) => ({ ...m, enchantments: [{ entityId: 9, cardId: 'BG22_HERO_001p_t1e' }] }))), dummy()), 0);
    expect(b.sides[0].board.map((m) => m.name)).toEqual(['Stone Elemental']);
  });

  it('Runic Arcanist casts Shiny Ring twice', () => {
    const b = newBattle(battle(side([minion('BG36_245'), vanilla(1, 1)]), dummy()));
    startOfCombat(b);
    expect(b.sides[0].board.map((m) => [m.attack, m.health])).toEqual([
      [4, 6],
      [3, 3],
    ]);
  });
});

describe('unsupported detection', () => {
  it('flags unhandled combat cards but not keyword-only minions', () => {
    const unhandled = db.data.cards.find(
      (c) => c.type === 'MINION' && c.mechanics.includes('DEATHRATTLE') && !getMinionHandler(c.id, db),
    );
    expect(unhandled).toBeDefined();
    const input = battle(side([minion(unhandled!.id), minion('BG25_001'), minion('BGS_119')]), side([vanilla(1, 1)]));
    const r = simulateBattle(input, { iterations: 10, seed: 1 });
    expect(r.unsupported).toEqual([unhandled!.id]);
    const unknown = { ...vanilla(1, 1), cardId: 'NOT_A_CARD', keywords: { deathrattle: true } };
    expect(simulateBattle(battle(side([unknown]), side([])), { iterations: 5, seed: 1 }).unsupported).toEqual(['NOT_A_CARD']);
  });

  it('flags unhandled Start of Combat hero powers', () => {
    const p = side([vanilla(1, 1)], { heroPowerCardId: 'BG22_HERO_000p' }); // Deadeye with an unknown target
    expect(simulateBattle(battle(p, side([])), { iterations: 5, seed: 1 }).unsupported).toEqual(['BG22_HERO_000p']);
  });
});

describe('simulation-level card checks', () => {
  it('golden Bonehead beats a plain wall more often than a normal one', () => {
    const opp = () => side([vanilla(2, 4), vanilla(2, 4)]);
    const normal = simulateBattle(battle(side([minion('BG28_300')]), opp()), RUNS);
    const golden = simulateBattle(battle(side([minion('BG28_300', { golden: true })]), opp()), RUNS);
    expect(golden.loss).toBeLessThanOrEqual(normal.loss);
  });
});
