/**
 * Effects that used to be reported as "not simulated" in current games: the last Timewarped minions,
 * hero powers / trinkets / quest rewards in play, Battlecries triggered in combat, hero Buddies and
 * hero-power tokens, plus the unsupported-detection false alarms.
 */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, MinionSnapshot, SimSide } from '@shared/types';
import { findUnsupportedCards } from '../../src/core/sim';
import { ensureCardsRegistered, getMinionHandler } from '../../src/core/sim/cards';
import { playBloodGem, summon } from '../../src/core/sim/engine/actions';
import { createBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { minionFromCard } from '../../src/core/sim/engine/minion';
import { Rng } from '../../src/core/sim/engine/rng';
import { startOfCombat } from '../../src/core/sim/engine/startOfCombat';
import type { AttackInfo, Battle, Minion } from '../../src/core/sim/engine/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const newBattle = (input: BattleSimInput, seed = 1) => createBattle(input, db, new Rng(seed));
const dummy = () => side([vanilla(0, 1000)]);
const p = (minions: MinionSnapshot[], opts: Partial<SimSide> = {}, opp: SimSide = dummy()) =>
  newBattle(battle(side(minions, opts), opp));
const stats = (m: { attack: number; health: number }) => [m.attack, m.health];
const board = (b: Battle) => b.sides[0].board;
function kill(b: Battle, ...indexes: number[]): Battle {
  for (const i of indexes) board(b)[i].health = 0;
  resolveDeaths(b);
  return b;
}
function rally(b: Battle, i: number): void {
  const m = board(b)[i];
  m.handler!.rally!(b, m, b.sides[1].board[0]);
}
const effect = (b: Battle, cardId: string) => b.sides[0].effects.find((e) => e.cardId === cardId)!;
const attackInfo = (attacker: Minion, target: Minion): AttackInfo => ({ attacker, target, killed: false, excess: 0, targetIndex: 0 });
/** A minion carrying `atk/hp` worth of Blood Gems (BG20_GEMe2 enchantment script data). */
function withGems(cardId: string, atk: number, hp: number, golden = false): MinionSnapshot {
  const m = minion(cardId, { golden });
  m.enchantments = [{ entityId: m.entityId * 100, cardId: 'BG20_GEMe2', scriptData1: atk, scriptData2: hp }];
  return m;
}
const flagged = (input: BattleSimInput) => findUnsupportedCards(input);
const solo = (s: SimSide) => battle(s, side([vanilla(1, 1)]));

describe('Battlecries triggered in combat', () => {
  it('Timewarped Greenskeeper triggers the right-most Battlecry and Deathrattle (golden: twice)', () => {
    // Hackerfin: Battlecry: Give your other minions +3/+2. Buzzing Vermin: Deathrattle: Summon a 2/2 Beetle.
    const b = p([minion('BG34_Giant_041'), vanilla(1, 1), minion('BG31_148'), minion('BG31_803')]);
    rally(b, 0);
    expect(stats(board(b)[1])).toEqual([4, 3]);
    expect(board(b).map((m) => m.cardId)).toContain('BG28_603t');
    const g = p([minion('BG34_Giant_041', { golden: true }), vanilla(1, 1), minion('BG31_148'), minion('BG31_803')]);
    rally(g, 0);
    expect(stats(board(g)[1])).toEqual([7, 5]);
    expect(board(g).filter((m) => m.cardId === 'BG28_603t')).toHaveLength(2);
  });

  it('Brann doubles and Dragon\'s Eye adds a trigger for Dragons', () => {
    const b = p([minion('BG34_Giant_041'), vanilla(1, 1), minion('BG_LOE_077'), minion('BG31_148')]);
    rally(b, 0);
    expect(stats(board(b)[1])).toEqual([7, 5]);
    // Electric Synthesizer (Dragon): Battlecry: Give your other Dragons +1/+1.
    const dragon = () => minion('BG36_212', { attack: 1, health: 1, tribes: ['DRAGON'] });
    const e = p([minion('BG34_Giant_041'), dragon(), minion('BG26_963')], { trinkets: [{ cardId: 'BG36_MagicItem_215' }] });
    rally(e, 0);
    expect(stats(board(e)[1])).toEqual([3, 3]);
  });

  it('Rylak Metalhead triggers an adjacent Battlecry; Rylak Portrait triggers it at Start of Combat', () => {
    const b = p([vanilla(1, 1), minion('BG31_148'), minion('BG26_801')], { trinkets: [{ cardId: 'BG35_MagicItem_834' }] });
    startOfCombat(b);
    expect(stats(board(b)[0])).toEqual([4, 3]);
    expect(flagged(solo(side([minion('BG26_801')], { trinkets: [{ cardId: 'BG35_MagicItem_834' }] })))).toEqual([]);
  });

  it('battlecries that destroy or make Golden pick a random valid target', () => {
    const b = p([minion('BG34_Giant_041'), minion('BG25_034'), minion('BG31_803')]); // Captain Sanders right-most battlecry
    rally(b, 0);
    expect(board(b).some((m) => m.golden)).toBe(true);
  });
});

describe('last Timewarped minions', () => {
  it('Bristler gives its Blood Gems to 2 other Quilboar (golden: twice)', () => {
    const q = () => minion('BG20_101', { attack: 1, health: 1 });
    const b = kill(p([withGems('BG34_Giant_104', 3, 4), q(), q(), q()]), 0);
    const gained = board(b).map((m) => stats(m));
    expect(gained.filter(([a, h]) => a === 4 && h === 5)).toHaveLength(2);
    const g = kill(p([withGems('BG34_Giant_104', 3, 4, true), q(), q()]), 0);
    expect(board(g).map(stats)).toEqual([
      [7, 9],
      [7, 9],
    ]);
  });

  it('Nellie\'s Ship summons a Pirate of the owner\'s Tier or lower', () => {
    const b = kill(p([minion('BG34_Giant_074t')], { tavernTier: 2 }), 0);
    expect(board(b)).toHaveLength(1);
    const card = db.get(board(b)[0].cardId)!;
    expect(card.tribes).toContain('PIRATE');
    expect(card.tier).toBeLessThanOrEqual(2);
  });

  it('Magnanimoose summons a copy of a minion of the opponent\'s warband', () => {
    const b = kill(p([minion('BG34_Giant_619')], {}, side([vanilla(9, 9)])), 0);
    expect(stats(board(b)[0])).toEqual([9, 9]);
  });

  it('Stone Drake gains its shown (X/X) at Start of Combat', () => {
    const b = p([minion('BG34_Giant_675', { tags: { TAG_SCRIPT_DATA_NUM_1: 5, TAG_SCRIPT_DATA_NUM_2: 7 } })]);
    startOfCombat(b);
    expect(stats(board(b)[0])).toEqual([11, 13]);
  });

  it('only Festergut stays flagged', () => {
    const ids = ['BG34_Giant_041', 'BG34_Giant_074t', 'BG34_Giant_104', 'BG34_Giant_590', 'BG34_Giant_619', 'BG34_Giant_675'];
    const out = ids.filter((id) => flagged(solo(side([minion(id)]))).length);
    expect(out).toEqual(['BG34_Giant_590']);
  });
});

describe('hero powers, trinkets and quest rewards in play', () => {
  it('Wax Warband gives one minion of each type +X/+X (X = hero power script data 3)', () => {
    const b = p(
      [minion('X', { tribes: ['BEAST'] }), minion('X', { tribes: ['BEAST'] }), minion('X', { tribes: ['MURLOC'] }), vanilla(1, 1)],
      { heroPowerCardId: 'TB_BaconShop_HP_037a', heroPowerData: { scriptData3: 3 } },
    );
    startOfCombat(b);
    const s = board(b).map((m) => m.attack);
    expect(s.slice(0, 2).sort()).toEqual([1, 4]);
    expect(s.slice(2)).toEqual([4, 1]);
  });

  it('Lock and Load is only reported after it was used this turn', () => {
    const tavish = (used?: boolean) => solo(side([vanilla(1, 1)], { heroPowerCardId: 'BG22_HERO_000p_Alt', heroPowerUsed: used }));
    expect(flagged(tavish(true))).toEqual(['BG22_HERO_000p_Alt']);
    expect(flagged(tavish(undefined))).toEqual(['BG22_HERO_000p_Alt']);
    expect(flagged(tavish(false))).toEqual([]);
  });

  it('Blood Golem Sticker summons a Golem with the dead Quilboar\'s Blood Gem stats in its slot', () => {
    const b = p([vanilla(1, 1), withGems('BG20_101', 3, 4), vanilla(1, 1)], { trinkets: [{ cardId: 'BG30_MagicItem_442' }] });
    playBloodGem(b, board(b)[1]); // +1/+1 more in combat
    kill(b, 1);
    expect(board(b)[1].cardId).toBe('BG30_MagicItem_442t');
    expect(stats(board(b)[1])).toEqual([4, 5]);
  });

  it('Jar o\' Gems plays a Blood Gem on all Quilboar after a Quilboar attacks', () => {
    const b = p([minion('BG20_101', { attack: 1, health: 1 }), minion('BG20_101', { attack: 1, health: 1 }), vanilla(1, 1)], {
      trinkets: [{ cardId: 'BG30_MagicItem_546' }],
    });
    const e = effect(b, 'BG30_MagicItem_546');
    e.handler.afterFriendlyAttack!(b, e, attackInfo(board(b)[0], b.sides[1].board[0]));
    e.handler.afterFriendlyAttack!(b, e, attackInfo(board(b)[2], b.sides[1].board[0])); // not a Quilboar
    expect(board(b).map((m) => m.attack)).toEqual([2, 2, 1]);
  });

  it('Artisanal Urn and Volatile Venom also reach minions summoned in combat', () => {
    const b = p([vanilla(1, 1)], { trinkets: [{ cardId: 'BG30_MagicItem_989' }], questRewards: ['BG24_Reward_364'] });
    const s = b.sides[0];
    summon(b, s, minionFromCard(b, s, 'BG_ICC_026t')); // 1/1 Undead Skeleton
    expect(stats(board(b)[1])).toEqual([11, 8]);
    const venom = effect(b, 'BG24_Reward_364');
    venom.handler.afterFriendlyAttack!(b, venom, attackInfo(board(b)[0], b.sides[1].board[0]));
    resolveDeaths(b);
    expect(board(b)).toHaveLength(1);
  });

  it('Snarky Portrait buffs Beasts when a Fishbait dies', () => {
    const b = p([minion('BG36_205'), minion('X', { attack: 1, health: 1, tribes: ['BEAST'] })], {
      trinkets: [{ cardId: 'BG36_MagicItem_450', scriptData1: 6, scriptData2: 5 }],
    });
    kill(b, 0);
    expect(stats(board(b)[0])).toEqual([7, 6]);
  });

  it('shop-only effects are not reported', () => {
    for (const id of ['BG30_MagicItem_868', 'BG36_MagicItem_214', 'BG36_MagicItem_215']) {
      expect(flagged(solo(side([vanilla(1, 1)], { trinkets: [{ cardId: id }] })))).toEqual([]);
    }
    for (const id of ['BG24_Reward_138', 'BG24_Reward_708', 'BG24_Reward_364']) {
      expect(flagged(solo(side([vanilla(1, 1)], { questRewards: [id] })))).toEqual([]);
    }
  });
});

describe('Buddies and hero-power tokens', () => {
  const COVERED = [
    'BG20_HERO_101_Buddy', 'BG20_HERO_201_Buddy', 'BG20_HERO_282_Buddy', 'BG21_HERO_030_Buddy', 'BG21_HERO_030t',
    'BG22_HERO_001_Buddy', 'BG23_HERO_201_Buddy', 'BG25_HERO_103_Buddy', 'BG26_HERO_101_Buddy', 'BG26_HERO_102_Buddy',
    'BG31_HERO_802pt', 'BG31_HERO_802pt1', 'BG31_HERO_802pt4', 'BG31_HERO_802pt5', 'BG31_HERO_802pt7',
    'BG31_HERO_811t10', 'BG31_HERO_811t2', 'BG31_HERO_811t3', 'BG31_HERO_811t4', 'BG31_HERO_811t5', 'BG31_HERO_811t6',
    'BG31_HERO_811t7', 'BG31_HERO_811t8', 'BG32_HERO_002_Buddy', 'TB_BaconShop_HERO_08_Buddy', 'TB_BaconShop_HERO_14_Buddy',
    'TB_BaconShop_HERO_15_Buddy', 'TB_BaconShop_HERO_17_Buddy', 'TB_BaconShop_HERO_18_Buddy', 'TB_BaconShop_HERO_22_Buddy',
    'TB_BaconShop_HERO_25_Buddy', 'TB_BaconShop_HERO_37_Buddy', 'TB_BaconShop_HERO_41_Buddy', 'TB_BaconShop_HERO_43_Buddy',
    'TB_BaconShop_HERO_45_Buddy', 'TB_BaconShop_HERO_52_Buddy', 'TB_BaconShop_HERO_53_Buddy', 'TB_BaconShop_HERO_56_Buddy',
    'TB_BaconShop_HERO_60_Buddy', 'TB_BaconShop_HERO_702_Buddy', 'TB_BaconShop_HERO_76_Buddy', 'TB_BaconShop_HERO_92_Buddy',
    'TB_BaconShop_HERO_95_Buddy', 'BG20_HERO_100_Buddy', 'BG27_513', 'BG26_801',
  ];

  it('are handled (normal and golden) and not reported', () => {
    for (const id of COVERED) {
      const g = db.goldenOf(id);
      expect(getMinionHandler(id, db), id).toBeDefined();
      for (const x of [id, g].filter(Boolean) as string[]) expect(flagged(solo(side([minion(x)]))), x).toEqual([]);
    }
  });

  it('effects the engine cannot model stay reported', () => {
    for (const id of ['BG25_HERO_100_Buddy', 'TB_BaconShop_HERO_33_Buddy', 'TB_BaconShop_HERO_39_Buddy']) {
      expect(flagged(solo(side([minion(id)])))).toEqual([id]);
    }
  });

  it('Elementium Squirrel Bomb hits once per friendly Mech that died this combat', () => {
    const enemy = side([vanilla(1, 100)]);
    const mech = () => minion('X', { attack: 1, health: 1, tribes: ['MECHANICAL'] });
    const b = kill(p([mech(), mech(), minion('TB_BaconShop_HERO_17_Buddy')], {}, enemy), 0, 1);
    kill(b, 0);
    expect(b.sides[1].board[0].health).toBe(100 - 12);
  });

  it('Zergling summons a copy of itself; Elder Taggawag needs 4 different types', () => {
    const z = p([minion('BG31_HERO_811t2', { attack: 5, health: 5 })]);
    startOfCombat(z);
    expect(board(z).map(stats)).toEqual([
      [5, 5],
      [5, 5],
    ]);
    const typed = (t: 'BEAST' | 'MURLOC' | 'DRAGON' | 'PIRATE', a: number) => minion('X', { attack: a, health: 2, tribes: [t] });
    const t = p([minion('TB_BaconShop_HERO_14_Buddy'), typed('BEAST', 9), typed('MURLOC', 1), typed('DRAGON', 1), typed('PIRATE', 1)]);
    startOfCombat(t);
    expect(stats(board(t)[0])).toEqual([13, 8]);
    const three = p([minion('TB_BaconShop_HERO_14_Buddy'), typed('BEAST', 9), typed('BEAST', 1), typed('DRAGON', 1), typed('PIRATE', 1)]);
    startOfCombat(three);
    expect(stats(board(three)[0])).toEqual([4, 4]);
  });

  it('Spirit Raptor calls upon its remembered Elements; Sr. Tomb Diver makes the right-most minion Golden', () => {
    const raptor = minion('BG22_HERO_001_Buddy', { enchantments: ['BG22_HERO_001_Buddy_e3'] }); // Water
    const b = kill(p([raptor, vanilla(1, 1)]), 0);
    expect(board(b)[0].divineShield && board(b)[0].taunt).toBe(true);
    const d = kill(p([minion('TB_BaconShop_HERO_41_Buddy'), minion('BG31_803'), minion('BG20_101')]), 0);
    expect(board(d).map((m) => m.golden)).toEqual([false, true]);
  });
});

describe('unsupported detection: false alarms and real gaps', () => {
  const withTrinket = (cardId: string) => solo(side([vanilla(2, 2)], { trinkets: [{ cardId }] }));
  it.each([
    ['BG22_HERO_007p', 'hero', "Azshara's Ambition (30 total Attack: a stat, not an attack)"],
    ['BG35_MagicItem_155', 'trinket', 'Felburned Ledger (hero damage only happens outside combat)'],
    ['BG30_MagicItem_869', 'trinket', 'Felblood Portrait (Tavern buffs)'],
    ['BG35_MagicItem_151', 'trinket', 'Defiler Portrait (Fodders in the Tavern)'],
  ])('does not flag %s (%s) - %s', (cardId, kind) => {
    const input = kind === 'hero' ? solo(side([vanilla(1, 1)], { heroPowerCardId: cardId })) : withTrinket(cardId);
    expect(flagged(input)).toEqual([]);
  });

  it('Deadeye is reported unless its hero power was not used this turn', () => {
    const s = (used?: boolean) => solo(side([vanilla(1, 1)], { heroPowerCardId: 'BG22_HERO_000p', heroPowerUsed: used }));
    expect(flagged(s(undefined))).toEqual(['BG22_HERO_000p']);
    expect(flagged(s(false))).toEqual([]);
  });

  it('checks second hero powers and the Duos teammate\'s effects too', () => {
    const extra = side([vanilla(1, 1)], { extraHeroPowers: [{ cardId: 'BG22_HERO_000p_Alt', used: true }] });
    expect(flagged(solo(extra))).toEqual(['BG22_HERO_000p_Alt']);
    const mate = side([vanilla(1, 1)], { trinkets: [{ cardId: 'BG30_MagicItem_803' }] });
    expect(flagged(solo(side([vanilla(1, 1)], { teammate: mate })))).toEqual(['BG30_MagicItem_803']);
  });

  it('still flags unhandled minions whose trigger is about stats or kills', () => {
    // Jelly Belly: "After a friendly minion is <b>Reborn</b>" (markup used to split "is Reborn").
    expect(flagged(solo(side([minion('BG25_005')])))).toEqual(['BG25_005']);
  });

  it('stat auras that also reach summoned minions are flagged until handled', () => {
    expect(flagged(withTrinket('BG30_MagicItem_880'))).toEqual([]); // Feral Talisman: handled
    const b = p([vanilla(1, 1)], { trinkets: [{ cardId: 'BG30_MagicItem_843t' }] }); // Horde Keychain: Tier 3 or lower
    const s = b.sides[0];
    summon(b, s, minionFromCard(b, s, 'BG_ICC_026t'));
    expect(stats(board(b)[1])).toEqual([8, 6]);
  });
});
