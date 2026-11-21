/**
 * Effects that were still reported as "not simulated" in replayed games: out-of-pool minions from older
 * logs (cards/legacy.ts) and the Buddies that copy other minions' stat gains (Mishmash, Titanic Guardian).
 */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, MinionSnapshot, SimSide } from '@shared/types';
import { findUnsupportedCards } from '../../src/core/sim';
import { ensureCardsRegistered } from '../../src/core/sim/cards';
import { attackImmediately, buff, buffHandCard, castSpell, playBloodGem, summon } from '../../src/core/sim/cards/helpers';
import { createBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { minionFromCard } from '../../src/core/sim/engine/minion';
import { Rng } from '../../src/core/sim/engine/rng';
import { startOfCombat } from '../../src/core/sim/engine/startOfCombat';
import type { Battle } from '../../src/core/sim/engine/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const newBattle = (input: BattleSimInput, seed = 1) => createBattle(input, db, new Rng(seed));
const dummy = () => side([vanilla(0, 1000)]);
const p = (minions: MinionSnapshot[], opts: Partial<SimSide> = {}, opp: SimSide = dummy(), seed = 1) =>
  newBattle(battle(side(minions, opts), opp), seed);
const stats = (m: { attack: number; health: number }) => [m.attack, m.health];
const board = (b: Battle, s = 0) => b.sides[s].board;
function kill(b: Battle, ...indexes: number[]): Battle {
  for (const i of indexes) board(b)[i].health = 0;
  resolveDeaths(b);
  return b;
}
const amalgam = () => minion('TB_BaconShop_HP_033t', { attack: 2, health: 2, tribes: ['ALL'] });

describe('stat-gain copies (Mishmash, Titanic Guardian)', () => {
  it('Mishmash gains what the Amalgam gains (golden: twice), not other minions\' gains', () => {
    const b = p([minion('TB_BaconShop_HERO_33_Buddy'), amalgam(), vanilla(1, 1)]);
    buff(b, board(b)[1], 3, 2);
    buff(b, board(b)[2], 5, 5);
    expect(stats(board(b)[0])).toEqual([4 + 3, 4 + 2]);
    const g = p([minion('TB_BaconShop_HERO_33_Buddy', { golden: true }), amalgam()]);
    buff(g, board(g)[1], 3, 2);
    expect(stats(board(g)[0])).toEqual([8 + 6, 8 + 4]);
  });

  it('Titanic Guardian copies other minions\' Health gains on the board and in hand', () => {
    const hand = [vanilla(1, 1)];
    const b = p([minion('TB_BaconShop_HERO_39_Buddy', { attack: 3, health: 3 }), vanilla(1, 1)], { hand });
    buff(b, board(b)[1], 5, 4);
    expect(stats(board(b)[0])).toEqual([3, 7]);
    buffHandCard(b, b.sides[0], b.sides[0].hand[0], 2, 3);
    expect(stats(board(b)[0])).toEqual([3, 10]);
    // Attack-only gains and its own gains do nothing.
    buff(b, board(b)[1], 5, 0);
    buff(b, board(b)[0], 0, 1);
    expect(stats(board(b)[0])).toEqual([3, 11]);
  });

  it('two Titanic Guardians do not echo each other forever', () => {
    const b = p([minion('TB_BaconShop_HERO_39_Buddy', { attack: 3, health: 3 }), minion('TB_BaconShop_HERO_39_Buddy', { attack: 3, health: 3 }), vanilla(1, 1)]);
    buff(b, board(b)[2], 0, 2);
    expect(board(b).map((m) => m.health)).toEqual([5, 5, 3]);
  });

  it('are no longer reported', () => {
    expect(findUnsupportedCards(battle(side([minion('TB_BaconShop_HERO_33_Buddy', { golden: true }), minion('TB_BaconShop_HERO_39_Buddy')]), dummy()))).toEqual([]);
  });
});

describe('out-of-pool Deathrattles', () => {
  it('Rat Pack summons a Rat per point of Attack (golden: 2/2 Rats)', () => {
    const b = kill(p([minion('BG_CFM_316', { attack: 3 })]), 0);
    expect(board(b).map((m) => [m.cardId, m.attack, m.health])).toEqual([
      ['BG_CFM_316t', 1, 1],
      ['BG_CFM_316t', 1, 1],
      ['BG_CFM_316t', 1, 1],
    ]);
    const g = kill(p([minion('BG_CFM_316', { golden: true, attack: 9 })]), 0);
    expect(board(g)).toHaveLength(7);
    expect(stats(board(g)[0])).toEqual([2, 2]);
  });

  it('Icky Imp summons two Imps (golden four), Imprisoner one (golden a 2/2)', () => {
    expect(board(kill(p([minion('BG21_029')]), 0))).toHaveLength(2);
    expect(board(kill(p([minion('BG21_029', { golden: true })]), 0)).map(stats)).toEqual([[1, 1], [1, 1], [1, 1], [1, 1]]);
    expect(board(kill(p([minion('BGS_014', { golden: true })]), 0)).map(stats)).toEqual([[2, 2]]);
  });

  it('Tunnel Blaster deals 3 damage to all minions (golden: twice)', () => {
    const b = kill(p([minion('BG_DAL_775'), vanilla(1, 10)], {}, side([vanilla(1, 10)])), 0);
    expect(board(b)[0].health).toBe(7);
    expect(board(b, 1)[0].health).toBe(7);
    const g = kill(p([minion('BG_DAL_775', { golden: true }), vanilla(1, 10)], {}, side([vanilla(1, 10)])), 0);
    expect(board(g, 1)[0].health).toBe(4);
  });

  it('Arid Atrocity\'s Golem is X/X times (1 + friendly minion types that died this combat)', () => {
    const beast = vanilla(1, 1);
    beast.tribes = ['BEAST'];
    const demon = vanilla(1, 1);
    demon.tribes = ['DEMON'];
    const b = kill(p([beast, demon, minion('BG29_864', { tags: { TAG_SCRIPT_DATA_NUM_1: 7 } })]), 0, 1);
    expect(board(b).map((m) => m.cardId)).toEqual(['BG29_864']);
    kill(b, 0);
    // Beast + Demon died before it: 7 x 3.
    expect(board(b).map((m) => [m.cardId, m.attack, m.health])).toEqual([['BG29_864t', 21, 21]]);
  });

  it('Kangor\'s Apprentice summons plain copies of the first 2 Mechs that died', () => {
    const b = p([minion('TB_BaconUps_041t', { attack: 9 }), vanilla(1, 1), minion('TB_BaconUps_002t'), minion('TB_BaconUps_041t'), minion('BGS_012')]);
    kill(b, 0, 1, 2, 3);
    kill(b, 0);
    expect(board(b).map((m) => [m.cardId, m.attack])).toEqual([
      ['TB_BaconUps_041t', 4],
      ['TB_BaconUps_002t', 2],
    ]);
  });

  it('Gentle Djinni / Briny Bootlegger count the cards they get', () => {
    const b = kill(p([minion('BGS_121')]), 0);
    expect(board(b)).toEqual([]);
    expect(findUnsupportedCards(battle(side([minion('BGS_121'), minion('BG21_017')]), dummy()))).toEqual([]);
  });
});

describe('out-of-pool triggers', () => {
  it('Ripsnarl Captain gives an attacking Pirate (itself included) +3 Attack (golden +6)', () => {
    const pirate = minion('X', { attack: 3, health: 50, tribes: ['PIRATE'] });
    const b = p([minion('BGS_056', { health: 50 }), pirate]);
    attackImmediately(b, board(b)[1]);
    expect(board(b)[1].attack).toBe(6);
    attackImmediately(b, board(b)[0]);
    expect(board(b)[0].attack).toBe(2 + 3);
    const g = p([minion('BGS_056', { golden: true, health: 50 }), minion('X', { attack: 3, health: 50, tribes: ['PIRATE'] })]);
    attackImmediately(g, board(g)[1]);
    expect(board(g)[1].attack).toBe(9);
  });

  it('Dozy Whelp gains +1 Attack whenever it is attacked', () => {
    const b = p([vanilla(1, 50)], {}, side([minion('BG24_300', { health: 50 })]));
    attackImmediately(b, board(b)[0]);
    expect(board(b, 1)[0].attack).toBe(db.get('BG24_300')!.attack! + 1);
  });

  it('Pack Leader gives summoned Beasts +2 Attack; Swampstriker / Saltscale Honcho react to Murlocs', () => {
    const b = p([minion('BGS_017'), minion('BG22_401'), minion('BG21_008'), minion('X', { attack: 1, health: 1, tribes: ['MURLOC'] })]);
    const beast = minionFromCard(b, b.sides[0], 'BG_CFM_316t');
    summon(b, b.sides[0], beast);
    expect(beast.attack).toBe(3);
    const murloc = minionFromCard(b, b.sides[0], 'X', { attack: 1, health: 1, tribes: ['MURLOC'] });
    summon(b, b.sides[0], murloc);
    const swamp = board(b)[1];
    expect(swamp.attack).toBe(db.get('BG22_401')!.attack! + 1); // the Beast summon did nothing
    // Saltscale Honcho: +2 Health to a Murloc other than the summoned one (Swampstriker, itself or the 1/1).
    const gained = swamp.health - db.get('BG22_401')!.health! + board(b)[2].health - db.get('BG21_008')!.health! + board(b)[3].health - 1;
    expect(gained).toBe(2);
    expect(murloc.health).toBe(1);
  });

  it('Scavenging Hyena and Soul Juggler react to friendly deaths', () => {
    const beast = minion('X', { attack: 1, health: 1, tribes: ['BEAST'] });
    const b = kill(p([minion('BG_EX1_531'), beast]), 1);
    expect(stats(board(b)[0])).toEqual([2 + 2, 2 + 1]);
    const demon = minion('X', { attack: 1, health: 1, tribes: ['DEMON'] });
    const j = kill(p([minion('BGS_002'), demon], {}, side([vanilla(1, 5), vanilla(1, 9)])), 1);
    expect(board(j, 1).map((m) => m.health)).toEqual([5, 5]);
  });

  it('Security Rover and Imp Mama summon when damaged', () => {
    const b = p([minion('TB_BaconUps_041')], {}, side([vanilla(1, 50)]));
    attackImmediately(b, board(b)[0]);
    expect(board(b).map((m) => m.cardId)).toEqual(['TB_BaconUps_041', 'TB_BaconUps_041t']);
    expect(board(b)[1].taunt).toBe(true);
    const m = p([minion('BGS_044')], {}, side([vanilla(1, 50)]));
    attackImmediately(m, board(m)[0]);
    expect(board(m)).toHaveLength(2);
    expect(board(m)[1].taunt).toBe(true);
    expect(db.get(board(m)[1].cardId)!.tribes).toContain('DEMON');
  });

  it('Glad-iator and Daggerspine Thrasher react to spells cast in combat', () => {
    const b = p([minion('BG27_025'), minion('BG27_024', { keywords: { divineShield: false } })]);
    castSpell(b, b.sides[0], 'TEST_SPELL');
    expect(board(b)[0].attack).toBe(db.get('BG27_025')!.attack! + 1);
    const t = board(b)[1];
    expect(t.divineShield || t.windfury || t.venomous).toBe(true);
  });

  it('Tough Tusk gains Divine Shield and Groundshaker buffs the others after a Blood Gem', () => {
    const b = p([minion('BG20_102'), minion('BG20_106'), vanilla(1, 1)]);
    playBloodGem(b, board(b)[0]);
    expect(board(b)[0].divineShield).toBe(true);
    playBloodGem(b, board(b)[1]);
    expect(board(b)[2].attack).toBe(3);
  });

  it('Master of Realities, Spacefarer and Hunter of Gatherers react to stat gains', () => {
    const elemental = minion('X', { attack: 1, health: 1, tribes: ['ELEMENTAL'] });
    const pirate = minion('X', { attack: 1, health: 1, tribes: ['PIRATE'] });
    const b = p([minion('BG21_036'), minion('BG31_820'), minion('BG25_027'), elemental, pirate]);
    const [master, spacefarer, hunter, el, pi] = board(b);
    const before = [stats(master), stats(spacefarer)];
    buff(b, el, 1, 0);
    expect(stats(master)).toEqual([before[0][0] + 2, before[0][1] + 2]);
    buff(b, pi, 1, 0);
    expect(spacefarer.health).toBe(before[1][1] + 2);
    const piHealth = pi.health;
    buff(b, hunter, 1, 0);
    expect(pi.health).toBe(piHealth + 2);
  });

  it('Phaerix gives Divine Shield after 4 friendly deaths', () => {
    const b = p([minion('BG28_403'), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1), vanilla(1, 1)]);
    kill(b, 1, 2, 3, 4);
    expect(board(b)[1].divineShield).toBe(true);
  });
});

describe('out-of-pool Start of Combat', () => {
  it('Mantid Queen gets one reward per minion type (golden: two)', () => {
    const t = (tr: string) => minion('X', { attack: 1, health: 1, tribes: [tr as 'BEAST'] });
    const b = p([minion('BG22_402'), t('BEAST'), t('BEAST'), t('MURLOC'), minion('X', { tribes: ['ALL'] })], {}, dummy(), 3);
    const q = board(b)[0];
    startOfCombat(b);
    // Beast, Murloc + one type from the all-type minion = 3 rewards.
    const rewards = (q.attack - 5) / 5 + Number(q.windfury) + Number(q.reborn) + Number(q.taunt);
    expect(rewards).toBe(3);
  });

  it('Yu\'lon makes the lowest-Tier minion Golden', () => {
    // Rat Pack is Tier 3, Pack Leader Tier 2.
    const b = p([minion('BG29_811'), minion('BG_CFM_316'), minion('BGS_017')]);
    startOfCombat(b);
    expect(board(b).map((m) => m.golden)).toEqual([false, false, true]);
    expect(board(b)[2].cardId).toBe('TB_BaconUps_086');
  });
});

describe('portrait trinkets that change a minion\'s effect', () => {
  const trinket = (cardId: string) => ({ trinkets: [{ cardId }] });

  it('Kaboom Bot Portrait: Kaboom Bot Deathrattles deal 10 extra damage', () => {
    const b = kill(p([minion('BG_BOT_606')], trinket('BG30_MagicItem_803'), side([vanilla(1, 100)])), 0);
    expect(board(b, 1)[0].health).toBe(100 - 14);
  });

  it('Impulsive Portrait: Impulsive Trickster gives its maximum Health to both adjacent minions', () => {
    const b = kill(p([vanilla(1, 1), minion('BG21_006', { attack: 6, health: 6 }), vanilla(1, 1), vanilla(1, 1)], trinket('BG32_MagicItem_820')), 1);
    expect(board(b).map((m) => m.health)).toEqual([7, 7, 1]);
  });

  it('Belcher Portrait: a minion that loses Venomous gains +4/+4 (greater +14/+14)', () => {
    const b = p([vanilla(2, 10, { venomous: true })], trinket('BG30_MagicItem_432'), side([vanilla(1, 50)]));
    attackImmediately(b, board(b)[0]);
    expect([board(b)[0].venomous, board(b)[0].attack, board(b)[0].health]).toEqual([false, 6, 13]);
    const g = p([vanilla(2, 10, { venomous: true })], trinket('BG30_MagicItem_432t'), side([vanilla(1, 50)]));
    attackImmediately(g, board(g)[0]);
    expect(stats(board(g)[0])).toEqual([16, 23]);
  });

  it('are no longer reported', () => {
    for (const id of ['BG30_MagicItem_803', 'BG32_MagicItem_820', 'BG30_MagicItem_432', 'BG30_MagicItem_432t']) {
      expect(findUnsupportedCards(battle(side([vanilla(1, 1)], trinket(id)), dummy()))).toEqual([]);
    }
  });
});

describe('unsupported detection for the legacy minions', () => {
  it('none of them is reported any more', () => {
    const ids = [
      'BG_CFM_316', 'BG22_402', 'BG21_029', 'BG22_401', 'BGS_017', 'BGS_121', 'BG21_020', 'BGS_056', 'BG29_864',
      'BG_EX1_531', 'BG27_025', 'BG21_036', 'BG30_117', 'BG27_024', 'BG24_300', 'BG20_102', 'BG21_037', 'BGS_027',
      'TB_BaconUps_041', 'BG28_403', 'BG29_811', 'BG29_877', 'BG25_027', 'BG26_535', 'BG28_635', 'BGS_012',
      'BG_DAL_775', 'BG31_820', 'BGS_014', 'BG23_014', 'BGS_002', 'BGS_044', 'BG21_008', 'BG21_017', 'BGS_081',
      'BG20_106', 'TB_BaconUps_002', 'BG_GVG_100', 'BGS_006',
    ];
    const flagged = ids.filter((id) => {
      const g = db.goldenOf(id);
      return [id, ...(g ? [g] : [])].some((x) => findUnsupportedCards(battle(side([minion(x)]), dummy())).length);
    });
    expect(flagged).toEqual([]);
  });
});
