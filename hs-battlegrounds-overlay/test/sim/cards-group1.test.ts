/**
 * Beast / Demon / Dragon / Elemental / Mech / Murloc handler audit (patch 37.0.2 card data):
 * coverage of every pool minion of these tribes plus focused tests of the added/fixed handlers.
 */
import { describe, expect, it } from 'vitest';
import { ensureCardsRegistered, getMinionHandler } from '../../src/core/sim/cards';
import { castSpell } from '../../src/core/sim/engine/actions';
import { attackImmediately, takeTurn } from '../../src/core/sim/engine/attack';
import { createBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { Rng } from '../../src/core/sim/engine/rng';
import { startOfCombat } from '../../src/core/sim/engine/startOfCombat';
import type { BattleSimInput } from '@shared/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const TRIBES = ['BEAST', 'DEMON', 'DRAGON', 'ELEMENTAL', 'MECHANICAL', 'MURLOC'];
const CHEFS_CHOICE = 'BG28_518'; // targeted Tavern spell (no stats)
const SHINY_RING = 'BG28_168'; // Give your minions +1/+1

const newBattle = (input: BattleSimInput, seed = 1) => createBattle(input, db, new Rng(seed));
const dummy = () => side([vanilla(0, 1000)]);
const stats = (m: { attack: number; health: number }) => [m.attack, m.health];

describe('group 1 coverage (Beast, Demon, Dragon, Elemental, Mech, Murloc)', () => {
  const pool = db.poolMinions().filter((c) => TRIBES.includes(c.tribes[0]));

  it('every pool minion has a combat handler or is marked noCombatEffect (normal and golden)', () => {
    expect(pool.length).toBe(139);
    const missing = pool.filter((c) => !getMinionHandler(c.id, db)).map((c) => `${c.id} ${c.name}`);
    expect(missing).toEqual([]);
    const missingGolden = pool
      .filter((c) => c.goldenId && !getMinionHandler(c.goldenId, db))
      .map((c) => `${c.goldenId} ${c.name}`);
    expect(missingGolden).toEqual([]);
  });

  it('only verified shop-only cards with combat keywords are marked noCombatEffect', () => {
    const combatMechanics = ['DEATHRATTLE', 'START_OF_COMBAT', 'AVENGE', 'BACON_RALLY', 'OVERKILL'];
    const flagged = pool
      .filter((c) => getMinionHandler(c.id, db)?.noCombatEffect && c.mechanics.some((m) => combatMechanics.includes(m)))
      .map((c) => c.id)
      .sort();
    // Each of these only gets a card / affects the Tavern or the teammate's hand.
    expect(flagged).toEqual(
      [
        'BG36_204', // Headhunter Gryphon - Rally: get a random Beast
        'BGDUO31_203', // Shifty Snake - DR: teammate gets a card
        'BG36_730', // Trapped Clapper - DR: Fodder in Refreshes
        'BG36_362', // Sacrificial Wrathguard - DR: Tavern buff
        'BG36_731', // Imp-lusionist - DR: get a spell
        'BG27_016', // Champion of Sargeras - DR: Tavern buff
        'BG36_242', // Bronze Timewalker - Rally: get a Chromadrake
        'BG32_820', // Firescale Hoarder - DR: get a Shiny Ring
        'BG34_633', // Draconic Warden - DR: get a Chromadrake
        'BG34_856', // Waveling - DR: Tavern buff after Refresh
        'BG35_881', // Leyline Surfacer - DR: get a spell
        'BGDUO_110', // Feisty Freshwater - DR: free Refreshes
        'BG36_854', // Rescue Bot - DR: get a spell
        'BG34_171', // Conveyor Construct - DR: get a Volumizer
        'BG32_336', // Gormling Gourmet - DR: get a spell
      ].sort(),
    );
  });
});

describe('mech: in-combat Magnetization (Glambot)', () => {
  it('Glambot magnetizes a 5/5; Mechagnome Interpreter adds +3/+1; Polarizing Beatboxer copies it', () => {
    const p = side([minion('BG36_853'), minion('BG31_177'), minion('BG26_149')]);
    const b = newBattle(battle(p, dummy()));
    const [glambot, interpreter, beatboxer] = b.sides[0].board;
    castSpell(b, b.sides[0], CHEFS_CHOICE, glambot);
    expect(stats(glambot)).toEqual([13, 11]); // 5/5 + 5/5 + 3/1
    expect(stats(beatboxer)).toEqual([13, 16]); // 5/10 + 5/5 + 3/1
    expect(stats(interpreter)).toEqual([3, 1]);
  });

  it('golden Beatboxer copies twice, golden Interpreter gives +6/+2; no echo when the host is the Beatboxer', () => {
    const p = side([minion('BG36_853'), minion('BG31_177', { golden: true }), minion('BG26_149', { golden: true })]);
    const b = newBattle(battle(p, dummy()));
    const [glambot, , beatboxer] = b.sides[0].board;
    castSpell(b, b.sides[0], CHEFS_CHOICE, glambot);
    expect(stats(glambot)).toEqual([16, 12]); // 5/5 + 5/5 + 6/2
    expect(stats(beatboxer)).toEqual([32, 34]); // 10/20 + 2 x (5/5 + 6/2)
    // Spell on the Beatboxer itself: it gets the Satellite once, nothing is copied.
    castSpell(b, b.sides[0], CHEFS_CHOICE, beatboxer);
    expect(stats(beatboxer)).toEqual([43, 41]);
    expect(stats(glambot)).toEqual([16, 12]);
  });

  it('Glambot ignores spells cast on non-Mechs', () => {
    const p = side([minion('BG36_853'), vanilla(1, 1)]);
    const b = newBattle(battle(p, dummy()));
    castSpell(b, b.sides[0], CHEFS_CHOICE, b.sides[0].board[1]);
    expect(b.sides[0].board.map(stats)).toEqual([
      [5, 5],
      [1, 1],
    ]);
  });
});

describe('mech: Enchanted Sentinel', () => {
  const tags = { TAVERN_SPELL_ATTACK_INCREASE: 1, TAVERN_SPELL_HEALTH_INCREASE: 1 };

  it('its spell bonus (already in the player tags) applies while it lives', () => {
    const b = newBattle(battle(side([minion('BG35_341'), vanilla(1, 1)], { playerTags: tags }), dummy()));
    castSpell(b, b.sides[0], SHINY_RING);
    expect(stats(b.sides[0].board[1])).toEqual([3, 3]);
  });

  it('removes its bonus when it dies (golden: +2)', () => {
    const b = newBattle(battle(side([minion('BG35_341'), vanilla(1, 1)], { playerTags: tags }), dummy()));
    b.sides[0].board[0].health = 0;
    resolveDeaths(b);
    expect([b.sides[0].spellAttackBonus, b.sides[0].spellHealthBonus]).toEqual([0, 0]);
    castSpell(b, b.sides[0], SHINY_RING);
    expect(stats(b.sides[0].board[0])).toEqual([2, 2]);

    const g = newBattle(
      battle(side([minion('BG35_341', { golden: true }), vanilla(1, 1)], { playerTags: { ...tags, TAVERN_SPELL_ATTACK_INCREASE: 3 } }), dummy()),
    );
    g.sides[0].board[0].health = 0;
    resolveDeaths(g);
    expect(g.sides[0].spellAttackBonus).toBe(1);
  });
});

describe('murloc: hand buffs reach minions summoned from hand later this combat', () => {
  it('Murcules: a kill gives a minion in hand +3/+3', () => {
    const p = side([minion('BG27_023')], { hand: [minion('BG31_149')] }); // Bubble Gunner 2/3
    const b = newBattle(battle(p, side([vanilla(0, 1), vanilla(0, 100)])));
    attackImmediately(b, b.sides[0].board[0], b.sides[1].board[0]);
    const h = b.sides[0].hand[0];
    expect(stats(h)).toEqual([5, 6]);
    expect(stats(h.snapshot)).toEqual([5, 6]);
    // No kill: no buff.
    attackImmediately(b, b.sides[0].board[0], b.sides[1].board[0]);
    expect(stats(h)).toEqual([5, 6]);
  });

  it('Murcules + Diremuck Forager: the delayed summon carries the bonus; input snapshot untouched', () => {
    const full = [minion('BG27_556'), minion('BG27_023', { golden: true }), ...Array.from({ length: 5 }, () => vanilla(1, 1))];
    const handCard = minion('BG32_860'); // Shoalfin Mystic 4/4
    const input = battle(side(full, { hand: [handCard] }), side([vanilla(0, 1), vanilla(0, 100)]));
    const b = newBattle(input);
    startOfCombat(b);
    expect(b.sides[0].board.length).toBe(7);
    attackImmediately(b, b.sides[0].board[1], b.sides[1].board[0]); // golden: +6/+6
    b.sides[0].board[6].health = 0;
    resolveDeaths(b);
    const summoned = b.sides[0].board[6];
    expect(summoned.name).toBe('Shoalfin Mystic');
    expect(stats(summoned)).toEqual([10, 10]);
    expect(stats(handCard)).toEqual([4, 4]);
  });

  it('Very Hungry Winterfinner: taking damage gives a minion in hand +2/+1 (golden +4/+2)', () => {
    for (const [golden, expected] of [
      [false, [4, 4]],
      [true, [6, 5]],
    ] as const) {
      const p = side([minion('BG29_300', { golden })], { hand: [minion('BG31_149')] });
      const b = newBattle(battle(p, side([vanilla(1, 100)])));
      takeTurn(b, b.sides[1]);
      expect(stats(b.sides[0].hand[0])).toEqual(expected);
    }
  });

  it('Twilight Tidehunter: a spell cast on it gives the left-most hand minion +9/+9', () => {
    const p = side([minion('BG36_703'), vanilla(1, 1)], { hand: [minion('BG31_149'), minion('BG32_860')] });
    const b = newBattle(battle(p, dummy()));
    castSpell(b, b.sides[0], CHEFS_CHOICE, b.sides[0].board[1]);
    expect(stats(b.sides[0].hand[0])).toEqual([2, 3]);
    castSpell(b, b.sides[0], CHEFS_CHOICE, b.sides[0].board[0]);
    expect(b.sides[0].hand.map(stats)).toEqual([
      [11, 12],
      [4, 4],
    ]);
  });

  it('Shamanic Tidecaller: hand Murlocs keep the bonus when Bassgill summons them', () => {
    const p = side([minion('BG36_704'), minion('BG26_350')], { hand: [minion('BG31_149'), vanilla(9, 9)] });
    const b = newBattle(battle(p, dummy()));
    castSpell(b, b.sides[0], CHEFS_CHOICE, b.sides[0].board[0]);
    expect(b.sides[0].hand.map(stats)).toEqual([
      [5, 7],
      [9, 9],
    ]);
    b.sides[0].board[1].health = 0;
    resolveDeaths(b);
    expect(b.sides[0].board.map((m) => [m.name, m.attack, m.health])).toEqual([
      ['Shamanic Tidecaller', 9, 13],
      ['Bubble Gunner', 5, 7],
    ]);
  });
});

describe('beast / dragon / elemental', () => {
  it('Flittering Bat summons a 1/1 Beast when it attacks (golden: two)', () => {
    const b = newBattle(battle(side([minion('BG36_200')]), dummy()));
    takeTurn(b, b.sides[0]);
    expect(b.sides[0].board.map((m) => [m.name, m.attack, m.health])).toEqual([
      ['Flittering Bat', 1, 4],
      ['Foraging Bat', 1, 1],
    ]);
    const g = newBattle(battle(side([minion('BG36_200', { golden: true })]), dummy()));
    takeTurn(g, g.sides[0]);
    expect(g.sides[0].board.length).toBe(3);
  });

  it('keyword-only and end-of-turn cards are registered as noCombatEffect', () => {
    for (const id of ['BGS_034', 'BGS_119', 'BG32_821']) expect(getMinionHandler(id, db)?.noCombatEffect).toBe(true);
  });
});
