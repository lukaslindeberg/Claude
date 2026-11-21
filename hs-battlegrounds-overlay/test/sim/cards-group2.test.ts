/**
 * Group 2 card handlers: Naga, Pirate, Quilboar, Undead, Aberration, neutral / all-type minions,
 * and the hero powers, trinkets, quest rewards and anomalies added in the same audit.
 */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, SimSide } from '@shared/types';
import { ensureCardsRegistered, getMinionHandler } from '../../src/core/sim/cards';
import { castSpell, dealDamage, summon } from '../../src/core/sim/engine/actions';
import { attackImmediately } from '../../src/core/sim/engine/attack';
import { createBattle, runBattle } from '../../src/core/sim/engine/battle';
import { endAnchor } from '../../src/core/sim/engine/board';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { minionFromCard } from '../../src/core/sim/engine/minion';
import { Rng } from '../../src/core/sim/engine/rng';
import { startOfCombat } from '../../src/core/sim/engine/startOfCombat';
import type { Battle } from '../../src/core/sim/engine/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const GROUP2 = new Set(['NAGA', 'PIRATE', 'QUILBOAR', 'UNDEAD', 'ABERRATION', 'NEUTRAL', 'ALL']);
const firstTribe = (tribes: string[]) => (tribes.length === 0 ? 'NEUTRAL' : tribes.includes('ALL') ? 'ALL' : tribes[0]);
/** C'Thun as the Deity, 10/10 pending. */
const DEITY = { BACON_GLOBAL_OLD_GOD_DBID: db.get('BGFYM_000')!.dbfId, BACON_OLD_GOD_ATTACK: 10, BACON_OLD_GOD_HEALTH: 10 };

const newBattle = (input: BattleSimInput, seed = 1) => createBattle(input, db, new Rng(seed));
const dummy = () => side([vanilla(0, 1000)]);
const stats = (m: { attack: number; health: number }) => [m.attack, m.health];
const deity = (b: Battle) => [b.sides[0].deity!.attack, b.sides[0].deity!.health];
const tenCards = () => Array.from({ length: 10 }, () => vanilla(1, 1));

/** Kill the player's minions at `indexes` together and resolve deaths. */
function kill(b: Battle, ...indexes: number[]): Battle {
  for (const i of indexes) b.sides[0].board[i].health = 0;
  resolveDeaths(b);
  return b;
}
const p = (minions: Parameters<typeof side>[0], opts: Partial<SimSide> = {}) => newBattle(battle(side(minions, opts), dummy()));
const withTrinket = (cardId: string, minions: Parameters<typeof side>[0], extra: Partial<SimSide> = {}, sd?: number[]) =>
  p(minions, { trinkets: [{ cardId, scriptData1: sd?.[0], scriptData2: sd?.[1] }], ...extra });

describe('group 2 coverage', () => {
  it('every pool minion of these tribes is handled or marked noCombatEffect', () => {
    const missing = db
      .poolMinions()
      .filter((c) => GROUP2.has(firstTribe(c.tribes)))
      .filter((c) => !getMinionHandler(c.id, db))
      .map((c) => `${c.id} ${c.name}`);
    expect(missing).toEqual([]);
  });
});

describe('cards added to hand in combat (The Shadow of Doubt)', () => {
  it('Unwilling Slacker deathrattle gives the Deity +4/+5 (golden Slacker: two cards)', () => {
    expect(deity(kill(p([minion('BG36_101'), minion('BG36_109')], { playerTags: DEITY }), 0))).toEqual([14, 15]);
    expect(deity(kill(p([minion('BG36_101', { golden: true }), minion('BG36_109')], { playerTags: DEITY }), 0))).toEqual([
      18, 20,
    ]);
    expect(deity(kill(p([minion('BG36_101'), minion('BG36_109', { golden: true })], { playerTags: DEITY }), 0))).toEqual([
      18, 20,
    ]);
  });

  it('a full hand (10 cards) gets nothing', () => {
    const b = p([minion('BG36_101'), minion('BG36_109')], { playerTags: DEITY, hand: tenCards() });
    expect(deity(kill(b, 0))).toEqual([10, 10]);
  });

  it('Avenge card getters (Drustfallen Butcher) and Locked-up Mutineer (only without a Lockbox)', () => {
    const v = () => vanilla(1, 1);
    const b = p([v(), v(), v(), v(), minion('BG32_324'), minion('BG36_109')], { playerTags: DEITY });
    expect(deity(kill(b, 0, 1, 2, 3))).toEqual([14, 15]);
    expect(deity(kill(p([minion('BG36_521'), minion('BG36_109')], { playerTags: DEITY }), 0))).toEqual([14, 15]);
    const lockbox = minion('BG36_520t');
    expect(deity(kill(p([minion('BG36_521'), minion('BG36_109')], { playerTags: DEITY, hand: [lockbox] }), 0))).toEqual([
      10, 10,
    ]);
  });

  it("Seafloor Recruiter's Chef's Choice gets a card", () => {
    const b = p([minion('BG34_925'), vanilla(1, 1), minion('BG36_109')], { playerTags: DEITY });
    const rec = b.sides[0].board[0];
    rec.handler!.rally!(b, rec, b.sides[1].board[0]);
    expect(deity(b)).toEqual([14, 15]);
  });

  it('Deathly Striker cannot get (nor summon) an Undead with a full hand', () => {
    const v = () => vanilla(1, 1);
    const b = p([minion('BG31_835'), v(), v(), v(), v()], { hand: tenCards() });
    kill(b, 1, 2, 3, 4);
    expect(kill(b, 0).sides[0].board.length).toBe(0);
    const ok = kill(p([minion('BG31_835'), v(), v(), v(), v()]), 1, 2, 3, 4);
    expect(kill(ok, 0).sides[0].board.length).toBe(1);
  });
});

describe('group 2 minions', () => {
  it('Dark Puppeteer / Friendly Geist improve Tavern spells cast later in combat', () => {
    const b = kill(p([minion('BG36_104'), minion('BG32_880', { golden: true }), vanilla(1, 1)]), 0, 1);
    expect([b.sides[0].spellAttackBonus, b.sides[0].spellHealthBonus]).toEqual([2, 4]);
    castSpell(b, b.sides[0], 'BG28_168'); // Shiny Ring: +1/+1 (+2/+4)
    expect(stats(b.sides[0].board[0])).toEqual([4, 6]);
    expect(kill(p([minion('BG36_104', { golden: true })]), 0).sides[0].spellHealthBonus).toBe(8);
  });

  it('Mummifier never gives Reborn to another (golden) Mummifier', () => {
    const b = kill(p([minion('BG28_309'), minion('BG28_309', { golden: true }), minion('BG25_013')]), 0);
    expect(b.sides[0].board.map((m) => m.reborn)).toEqual([false, true]);
  });

  it("Dark Paradox (Toreth's gift): Divine Shield takes 3 hits (golden: 4)", () => {
    for (const [id, hits] of [['BG36_360t4', 3], ['BG36_360_Gt4', 4]] as const) {
      const b = p([minion(id, { attack: 1, health: 5 })]);
      const m = b.sides[0].board[0];
      for (let i = 1; i < hits; i++) dealDamage(b, null, m, 3);
      expect([m.divineShield, m.health]).toEqual([true, 5]);
      dealDamage(b, null, m, 3);
      expect(m.divineShield).toBe(false);
      dealDamage(b, null, m, 3);
      expect(m.health).toBe(2);
    }
  });

  it('Dark Paradox (Golemancy): Deathrattle summons a Golem with its stats (golden: double)', () => {
    expect(stats(kill(p([minion('BG36_360t9', { attack: 5, health: 7 })]), 0).sides[0].board[0])).toEqual([5, 7]);
    expect(stats(kill(p([minion('BG36_360_Gt9', { attack: 5, health: 7 })]), 0).sides[0].board[0])).toEqual([10, 14]);
  });

  it('Gatekeeper Amalgam casts Misplaced Tea Set when a spell is cast on it', () => {
    const b = p([minion('BG34_925'), minion('BG36_640')]);
    const [rec, gate] = b.sides[0].board;
    rec.handler!.rally!(b, rec, b.sides[1].board[0]);
    // Tea Set: a friendly minion of each type +3/+3 -> the Naga and the all-type Amalgam.
    expect([stats(rec), stats(gate)]).toEqual([
      [6, 8],
      [9, 9],
    ]);
    expect(b.sides[0].spellsCastThisCombat).toBe(2);
  });

  it("Sandy transforms into the teammate's highest-Health minion (golden: Golden copy)", () => {
    const team = side([minion('BG23_318'), vanilla(1, 1)]);
    const b = p([minion('BGDUO_125')], { teammate: team });
    startOfCombat(b);
    expect([b.sides[0].board[0].cardId, ...stats(b.sides[0].board[0])]).toEqual(['BG23_318', 6, 2]);
    const g = p([minion('BGDUO_125', { golden: true })], { teammate: side([minion('BG23_318'), vanilla(1, 1)]) });
    startOfCombat(g);
    expect([g.sides[0].board[0].cardId, ...stats(g.sides[0].board[0])]).toEqual(['BG23_318_G', 12, 4]);
  });
});

describe('group 2 hero powers', () => {
  it('Glory of Combat: a friendly minion that kills an enemy gains +1 Attack', () => {
    const b = newBattle(battle(side([vanilla(5, 5)], { heroPowerCardId: 'BG20_HERO_100p' }), side([vanilla(1, 1), vanilla(1, 1)])));
    const m = b.sides[0].board[0];
    attackImmediately(b, m, b.sides[1].board[0]);
    expect(stats(m)).toEqual([6, 4]);
  });

  it("Glorious Gloop: the chosen minion becomes the teammate's highest-Tier minion", () => {
    const chosen = minion('TEST_VANILLA', { attack: 1, health: 1, enchantments: ['BGDUO_HERO_101pe2'] });
    const b = p([vanilla(2, 2), chosen], { heroPowerCardId: 'BGDUO_HERO_101p', teammate: side([minion('BG28_300'), minion('BG23_318')]) });
    startOfCombat(b);
    expect(b.sides[0].board.map((m) => m.cardId)).toEqual(['TEST_VANILLA', 'BG23_318']);
  });
});

describe('group 2 trinkets, quest rewards, anomalies', () => {
  it('Ship in a Bottle summons a Pirate that attacks immediately', () => {
    const b = newBattle(
      battle(side([vanilla(1, 1)], { trinkets: [{ cardId: 'BG30_MagicItem_407' }] }), dummy(), { availableTribes: ['PIRATE'] }),
    );
    startOfCombat(b);
    expect(b.sides[0].board[1].tribes).toContain('PIRATE');
    expect(b.sides[1].board[0].health).toBeLessThan(1000);
  });

  it('Tiger Carving: another friendly minion gains +3/+1 (greater: +6/+2) when one takes damage', () => {
    for (const [id, exp] of [['BG30_MagicItem_427', [4, 11]], ['BG30_MagicItem_427t', [7, 12]]] as const) {
      const b = withTrinket(id, [vanilla(1, 10), vanilla(1, 10)]);
      dealDamage(b, null, b.sides[0].board[0], 2);
      expect(stats(b.sides[0].board[1])).toEqual(exp);
    }
  });

  it('spell-cast trinkets: Comfy Coffin, Wizard’s Pipe, Bluegill Flippers, Bewitched Ribbon, Lorewalker Scroll', () => {
    const cast = (id: string, minions: Parameters<typeof side>[0], target = false) => {
      const b = withTrinket(id, minions);
      castSpell(b, b.sides[0], target ? 'BG28_518' : 'BG28_168', target ? b.sides[0].board[0] : null);
      return b;
    };
    const coffin = cast('BG30_MagicItem_547t', [minion('BG25_013')]);
    expect([coffin.sides[0].undeadAttackBonus, ...stats(coffin.sides[0].board[0])]).toEqual([2, 4, 5]);
    expect(stats(cast('BG32_MagicItem_281', [vanilla(1, 1)]).sides[0].board[0])).toEqual([6, 6]);
    expect(stats(cast('BG32_MagicItem_893', [vanilla(1, 1), vanilla(1, 1)]).sides[0].board[1])).toEqual([2, 2]);
    expect(stats(cast('BG32_MagicItem_893', [vanilla(1, 1)]).sides[0].board[0])).toEqual([5, 5]);
    expect(stats(cast('BG35_MagicItem_923', [vanilla(1, 1)]).sides[0].board[0])).toEqual([4, 4]);
    expect(stats(cast('BG30_MagicItem_422', [vanilla(1, 1)], true).sides[0].board[0])).toEqual([5, 5]);
  });

  it('Fishy Sticker summons a Golden Fish of N’Zoth; Summoning Sphere copies the teammate’s highest-Health minion', () => {
    const f = withTrinket('BG30_MagicItem_821t2', [vanilla(1, 1)]);
    startOfCombat(f);
    expect(f.sides[0].board[1].cardId).toBe('TB_BaconUps_307');
    const s = withTrinket('BGDUO_MagicItem_003', [vanilla(1, 1)], { teammate: side([vanilla(2, 9), vanilla(9, 2)]) });
    startOfCombat(s);
    expect(stats(s.sides[0].board[1])).toEqual([2, 9]);
  });

  it('Gilnean Thorned Rose: Avenge (3) gives +4/+5 then deals 1 damage', () => {
    const v = () => vanilla(1, 3);
    const b = kill(withTrinket('BG30_MagicItem_864', [v(), v(), v(), v()]), 0, 1, 2);
    expect([b.sides[0].board[0].attack, b.sides[0].board[0].health, b.sides[0].board[0].maxHealth]).toEqual([5, 7, 8]);
  });

  it('Reinforced Shield shields the first 5 summons; Mama Bear Sticker buffs summoned Beasts', () => {
    const b = withTrinket('BG30_MagicItem_886', [vanilla(1, 1)]);
    const s = b.sides[0];
    for (let i = 0; i < 6; i++) summon(b, s, minionFromCard(b, s, 'TEST_VANILLA', { attack: 1, health: 1 }), endAnchor(s));
    expect(s.board.slice(1).map((m) => m.divineShield)).toEqual([true, true, true, true, true, false]);
    const m = withTrinket('BG35_MagicItem_871', [vanilla(1, 1)]);
    const beast = minionFromCard(m, m.sides[0], 'TEST_VANILLA', { attack: 1, health: 1, tribes: ['BEAST'] });
    summon(m, m.sides[0], beast, endAnchor(m.sides[0]));
    expect(stats(beast)).toEqual([8, 8]);
  });

  it('Mechagon Adapter restores a Mech’s Divine Shield 3 times per combat', () => {
    const b = withTrinket('BG30_MagicItem_910', [vanilla(1, 5, { divineShield: true })]);
    const mech = b.sides[0].board[0];
    mech.tribes = ['MECHANICAL'];
    for (let i = 0; i < 4; i++) dealDamage(b, null, mech, 2);
    expect([mech.divineShield, mech.health]).toEqual([false, 5]);
  });

  it('Yu’lon Sticker makes the highest-Tier Dragon Golden; Stolen Gold the left- and right-most minions', () => {
    const y = withTrinket('BG32_MagicItem_419', [minion('BG36_240'), minion('BG36_243')]);
    startOfCombat(y);
    expect(y.sides[0].board.map((m) => [m.cardId, m.attack, m.health])).toEqual([
      ['BG36_240', 3, 5],
      ['BG36_243_G', 8, 14],
    ]);
    const g = p([minion('BG23_318'), vanilla(1, 1), minion('BG28_300')], { questRewards: ['BG24_Reward_109'] });
    startOfCombat(g);
    expect(g.sides[0].board.map((m) => [m.cardId, m.mult, m.attack])).toEqual([
      ['BG23_318_G', 2, 12],
      ['TEST_VANILLA', 1, 1],
      ['BG28_300_G', 2, 2],
    ]);
  });

  it('Vash’jir Anemone gives your Naga Health from script data', () => {
    const b = withTrinket('BG32_MagicItem_932', [vanilla(1, 1, {}, 1), vanilla(1, 1)], {}, [4, 3]);
    b.sides[0].board[0].tribes = ['NAGA'];
    startOfCombat(b);
    expect(b.sides[0].board.map(stats)).toEqual([
      [1, 4],
      [1, 1],
    ]);
  });

  it('Blood Gem trinkets: Scrapsmith Portrait, Blood Amulet; Quilligraphy Set and Wicked Tome avenges', () => {
    const s = kill(withTrinket('BG35_MagicItem_430', [vanilla(1, 1, { taunt: true }), minion('BG24_707')]), 0);
    expect(stats(s.sides[0].board[0])).toEqual([5, 5]);
    const a = kill(withTrinket('BG35_MagicItem_432', [minion('BG28_300'), vanilla(1, 1)]), 0);
    expect(a.sides[0].board.map(stats)).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
    ]);
    const v = () => vanilla(1, 1);
    const q = kill(withTrinket('BG30_MagicItem_410', [v(), v(), v(), v()]), 0, 1, 2);
    expect([q.sides[0].bloodGemAttack, q.sides[0].bloodGemHealth]).toEqual([1, 2]);
    const w = kill(withTrinket('BG32_MagicItem_270', [v(), v(), v(), v()]), 0, 1, 2);
    expect(w.sides[0].spellAttackBonus).toBe(1);
  });

  it('Cloud Serpent Horn: Avenge (3) gives the right-most minion’s Attack to a Dragon', () => {
    const v = () => vanilla(1, 1);
    const b = withTrinket('BG35_MagicItem_849', [v(), v(), v(), vanilla(2, 2), vanilla(9, 9)]);
    b.sides[0].board[3].tribes = ['DRAGON'];
    kill(b, 0, 1, 2);
    expect(stats(b.sides[0].board[0])).toEqual([11, 2]);
  });

  it('Fridge Magnet and Cycle of Energy get cards (The Shadow of Doubt)', () => {
    const v = () => vanilla(1, 1);
    const f = kill(withTrinket('BG30_MagicItem_545', [v(), v(), v(), minion('BG36_109')], { playerTags: DEITY }), 0, 1, 2);
    expect(deity(f)).toEqual([14, 15]);
    const c = kill(p([v(), v(), v(), minion('BG36_109')], { playerTags: DEITY, questRewards: ['BG28_Reward_504'] }), 0, 1, 2);
    expect(deity(c)).toEqual([14, 15]);
  });

  it('Curse of Aggramar: combat damage is capped at 1', () => {
    const input = battle(side([vanilla(10, 10)], { tavernTier: 6 }), side([vanilla(1, 1)]), { anomalyCardId: 'BG27_Anomaly_006' });
    expect(runBattle(newBattle(input))).toEqual({ result: 1, damage: 1 });
    expect(input.damageCap).toBeUndefined();
  });
});
