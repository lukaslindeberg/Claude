/**
 * Timewarped minions (patch 37.0.2 card data, `timewarped: true`): coverage of every Timewarped
 * minion plus focused, seeded tests of each handler family in `src/core/sim/cards/timewarped.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, MinionKeywords, MinionSnapshot, Tribe } from '@shared/types';
import { findUnsupportedCards, simulateOnce } from '../../src/core/sim/simulate';
import { ensureCardsRegistered, getMinionHandler } from '../../src/core/sim/cards';
import { buff, castSpell, dealDamage, destroy, playBloodGem } from '../../src/core/sim/engine/actions';
import { attackImmediately } from '../../src/core/sim/engine/attack';
import { createBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { Rng } from '../../src/core/sim/engine/rng';
import { startOfCombat } from '../../src/core/sim/engine/startOfCombat';
import type { Battle, Minion } from '../../src/core/sim/engine/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

const CHEFS_CHOICE = 'BG28_518'; // Tavern spell without combat stats
const SHINY_RING = 'BG28_168'; // Give your minions +1/+1
const SKELETON = 'BG_ICC_026t';
const BONEHEAD = 'BG28_300'; // Harmless Bonehead: Deathrattle: Summon two 1/1 Skeletons
const SD1 = 'TAG_SCRIPT_DATA_NUM_1';
const SD4 = 'TAG_SCRIPT_DATA_NUM_4';

const newBattle = (input: BattleSimInput, seed = 1) => createBattle(input, db, new Rng(seed));
const dummy = () => side([vanilla(0, 1000)]);
const stats = (m: { attack: number; health: number }) => [m.attack, m.health];
const tribal = (attack: number, health: number, tribes: Tribe[], keywords: MinionKeywords = {}): MinionSnapshot =>
  minion('TEST_VANILLA', { attack, health, tribes, keywords });
const tw = (suffix: string, golden = false) => minion(`BG34_${suffix}`, { golden });
/** Battle with `minions` on our side against a 0/1000 dummy. */
const ours = (minions: MinionSnapshot[], opts: Parameters<typeof side>[1] = {}, seed = 1) =>
  newBattle(battle(side(minions, opts), dummy()), seed);
const kill = (b: Battle, m: Minion) => {
  destroy(b, m);
  resolveDeaths(b);
};
const board = (b: Battle) => b.sides[0].board;
const ids = (b: Battle) => board(b).map((m) => m.cardId);

const COMBAT_MECHANICS = ['DEATHRATTLE', 'START_OF_COMBAT', 'AVENGE', 'BACON_RALLY', 'OVERKILL'];

/** Not simulated on purpose (see the header of cards/timewarped.ts): they must stay flagged. */
const UNSUPPORTED = [
  'BG34_Giant_041', // Greenskeeper - triggers a Battlecry in combat
  'BG34_Giant_074t', // Nellie's Ship - Discovered crew unknown
  'BG34_Giant_104', // Bristler - Blood Gem count unknown
  'BG34_Giant_590', // Festergut - Undead Creations
  'BG34_Giant_619', // Magnanimoose - random opponent's warband
  'BG34_Giant_675', // Stone Drake - stats sold this turn unknown
];

describe('Timewarped coverage', () => {
  const all = db.data.cards.filter((c) => c.timewarped && c.type === 'MINION' && !c.golden);

  it('every Timewarped minion is handled or marked noCombatEffect (normal and golden)', () => {
    expect(all.length).toBe(158);
    const missing = all.filter((c) => !getMinionHandler(c.id, db)).map((c) => c.id);
    expect(missing.sort()).toEqual([...UNSUPPORTED].sort());
    const missingGolden = all.filter((c) => c.goldenId && !getMinionHandler(c.goldenId, db)).map((c) => c.id);
    expect(missingGolden.sort()).toEqual([...UNSUPPORTED].sort());
    expect(all.filter((c) => !c.goldenId)).toEqual([]);
  });

  it('only the deliberately unsupported Timewarped minions are reported as not simulated', () => {
    const flagged = new Set<string>();
    for (const c of all) {
      for (const id of [c.id, c.goldenId!]) {
        const found = findUnsupportedCards(battle(side([minion(id)]), side([vanilla(1, 1)])));
        if (found.length) flagged.add(c.id);
      }
    }
    expect([...flagged].sort()).toEqual([...UNSUPPORTED].sort());
  });

  it('only verified shop-only cards with combat keywords are marked noCombatEffect', () => {
    const flagged = all
      .filter((c) => getMinionHandler(c.id, db)?.noCombatEffect && c.mechanics.some((m) => COMBAT_MECHANICS.includes(m)))
      .map((c) => c.id)
      .sort();
    expect(flagged).toEqual(
      [
        'BG34_Giant_001', // Busker - Battlecry and Deathrattle: Gain Gold next turn
        'BG34_Giant_082', // Recycler - Avenge (4): Increase your maximum Gold
        'BG34_Giant_330', // Radio Star - Deathrattle: Get a copy of the killer (undead.ts)
        'BG34_PreMadeChamp_067', // Plunderer - Deathrattle: Increase your maximum Gold
      ].sort(),
    );
  });

  it('boards of Timewarped minions fight without errors', () => {
    const snaps = (golden: boolean) => all.map((c) => minion(c.id, { golden }));
    for (const golden of [false, true]) {
      const list = snaps(golden);
      for (let i = 0; i < list.length; i += 5) {
        const a = list.slice(i, i + 5);
        const c = list.slice((i + 40) % list.length, ((i + 40) % list.length) + 5);
        const input = battle(
          side(a, { tavernTier: 5, hand: [vanilla(3, 4), vanilla(2, 6)] }),
          side(c, { tavernTier: 5, hand: [vanilla(5, 5)] }),
        );
        for (let seed = 1; seed <= 6; seed++) {
          expect(() => simulateOnce(input, new Rng(seed * 31 + i), db)).not.toThrow();
        }
      }
    }
  });
});

describe('Timewarped deathrattles', () => {
  it('Trickster gives its maximum stats (golden: twice)', () => {
    let b = ours([tw('Giant_010'), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    expect(stats(board(b)[0])).toEqual([9, 9]);
    b = ours([tw('Giant_010', true), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    expect(stats(board(b)[0])).toEqual([33, 33]);
  });

  it('Scourfin buffs a hand minion by +7/+7 and summons it', () => {
    const b = ours([tw('Giant_017')], { hand: [vanilla(2, 3)] });
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([[9, 10]]);
    expect(b.sides[0].hand.length).toBe(0);
  });

  it('Leapfrogger passes +1/+1 and its Deathrattle on, then comes back Reborn', () => {
    const b = ours([tw('Giant_031'), tribal(2, 2, ['BEAST'])]);
    kill(b, board(b)[0]);
    const [frog, beast] = board(b);
    expect(stats(frog)).toEqual([3, 1]); // Reborn
    expect(stats(beast)).toEqual([3, 3]);
    expect(beast.extraDeathrattles.length).toBe(1);
    kill(b, beast);
    expect(stats(frog)).toEqual([4, 2]);
    expect(frog.extraDeathrattles.length).toBe(1);
  });

  it('Geist improves Tavern spells by +2/+2; Jazzer improves Blood Gem Health by 2', () => {
    const b = ours([tw('Giant_034'), tw('Giant_306'), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    kill(b, board(b)[0]);
    expect([b.sides[0].spellAttackBonus, b.sides[0].spellHealthBonus]).toEqual([2, 2]);
    expect(b.sides[0].bloodGemHealth).toBe(3);
    castSpell(b, b.sides[0], SHINY_RING);
    expect(stats(board(b)[0])).toEqual([4, 4]);
  });

  it('Bassgill summons the highest-Health hand minion with Divine Shield (golden: two)', () => {
    let b = ours([tw('Giant_071')], { hand: [vanilla(2, 3), vanilla(1, 9)] });
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([[1, 9]]);
    expect(board(b)[0].divineShield).toBe(true);
    b = ours([tw('Giant_071', true)], { hand: [vanilla(2, 3), vanilla(1, 9)] });
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([
      [1, 9],
      [2, 3],
    ]);
    expect(board(b).every((m) => m.divineShield)).toBe(true);
  });

  it('Tide Razor summons 4 random Pirates', () => {
    const b = ours([tw('Giant_328'), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    expect(board(b).length).toBe(5);
    expect(board(b).filter((m) => m.tribes.includes('PIRATE')).length).toBe(4);
  });

  it("Warghoul triggers an adjacent Deathrattle (golden: both adjacent minions')", () => {
    let b = ours([minion(BONEHEAD), tw('Giant_331'), vanilla(1, 1)]);
    kill(b, board(b)[1]);
    expect(ids(b)).toEqual([BONEHEAD, SKELETON, SKELETON, 'TEST_VANILLA']);
    b = ours([minion(BONEHEAD), tw('Giant_331', true), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(ids(b)).toEqual([BONEHEAD, SKELETON, SKELETON, BONEHEAD, SKELETON, SKELETON]);
  });

  it('Goldrinn gives Beasts +4/+4 for the rest of the game (also later summons)', () => {
    const b = ours([tw('Giant_362'), tribal(1, 1, ['BEAST']), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([
      [5, 5],
      [1, 1],
    ]);
    expect(b.sides[0].summonBuffs).toEqual([{ tribe: 'BEAST', attack: 4, health: 4 }]);
  });

  it('Spirit of Air gives Windfury, Divine Shield and Taunt', () => {
    const b = ours([tw('Giant_592'), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    const m = board(b)[0];
    expect([m.windfury, m.divineShield, m.taunt]).toEqual([true, true, true]);
  });

  it("Lil' Quilboar plays 3 Blood Gems on all Quilboar, then is Reborn", () => {
    const b = ours([tw('Giant_608'), tribal(1, 1, ['QUILBOAR']), vanilla(1, 1)]);
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([
      [5, 1],
      [4, 4],
      [1, 1],
    ]);
  });

  it("Caretaker: Skeletons that don't fit give Undead +1 Attack each", () => {
    const b = ours([tw('Giant_618'), tribal(1, 1, ['UNDEAD']), ...[1, 2, 3, 4, 5].map(() => vanilla(1, 1))]);
    kill(b, board(b)[0]);
    expect(board(b).length).toBe(7);
    expect(b.sides[0].undeadAttackBonus).toBe(4);
    expect(board(b).slice(0, 2).map(stats)).toEqual([
      [5, 1], // the one Skeleton that fit
      [5, 1],
    ]);
  });

  it('Icky Imp summons 2 Imps with its maximum stats (golden: 4)', () => {
    let b = ours([tw('Giant_674')]);
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([
      [12, 12],
      [12, 12],
    ]);
    expect(board(b)[0].tribes).toEqual(['DEMON']);
    b = ours([tw('Giant_674', true)]);
    kill(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([1, 2, 3, 4].map(() => [24, 24]));
  });
});

describe('Timewarped Start of Combat', () => {
  it('Dragonling gives itself and its neighbours stats equal to the Tavern Tier (golden: twice)', () => {
    let b = ours([vanilla(1, 1), tw('Giant_029'), vanilla(1, 1), vanilla(1, 1)], { tavernTier: 4 });
    startOfCombat(b);
    expect(board(b).map(stats)).toEqual([
      [5, 5],
      [7, 7],
      [5, 5],
      [1, 1],
    ]);
    b = ours([tw('Giant_029', true), vanilla(1, 1)], { tavernTier: 4 });
    startOfCombat(b);
    expect(board(b).map(stats)).toEqual([
      [14, 14],
      [9, 9],
    ]);
  });

  it('Chameleon transforms into a copy of the minion to its left (golden: a Golden copy)', () => {
    let b = ours([vanilla(5, 7, { divineShield: true }), tw('Giant_042')]);
    startOfCombat(b);
    expect(ids(b)).toEqual(['TEST_VANILLA', 'TEST_VANILLA']);
    expect(stats(board(b)[1])).toEqual([5, 7]);
    expect(board(b)[1].divineShield).toBe(true);
    b = ours([minion(BONEHEAD), tw('Giant_042', true)]);
    startOfCombat(b);
    expect(ids(b)).toEqual([BONEHEAD, `${BONEHEAD}_G`]);
    expect(stats(board(b)[1])).toEqual([2, 2]);
    kill(b, board(b)[1]);
    expect(board(b).length).toBe(5); // Bonehead + four Skeletons
    // Left-most Chameleon: nothing to copy.
    b = ours([tw('Giant_042'), vanilla(1, 1)]);
    startOfCombat(b);
    expect(ids(b)[0]).toBe('BG34_Giant_042');
  });

  it('Promo-Drake gives +X/+X from script data 4', () => {
    let b = ours([tw('Giant_088'), vanilla(1, 1)]);
    startOfCombat(b);
    expect(board(b).map(stats)).toEqual([
      [11, 11],
      [6, 6],
    ]);
    b = ours([minion('BG34_Giant_088', { tags: { [SD4]: 9 } }), vanilla(1, 1)]);
    startOfCombat(b);
    expect(stats(board(b)[1])).toEqual([10, 10]);
    b = ours([tw('Giant_088', true), vanilla(1, 1)]);
    startOfCombat(b);
    expect(stats(board(b)[1])).toEqual([11, 11]);
  });

  it('Red Whelp deals 3 damage to two enemies (golden card: 2 damage to four)', () => {
    const enemies = () => side([1, 2, 3, 4, 5].map(() => vanilla(0, 10)));
    let b = newBattle(battle(side([tw('Giant_091')]), enemies()));
    startOfCombat(b);
    expect(b.sides[1].board.map((m) => m.health).sort()).toEqual([10, 10, 10, 7, 7]);
    b = newBattle(battle(side([tw('Giant_091', true)]), enemies()));
    startOfCombat(b);
    expect(b.sides[1].board.map((m) => m.health).sort()).toEqual([10, 8, 8, 8, 8]);
  });

  it('Mrrrglr gives adjacent Murlocs the stats of the hand', () => {
    const b = ours([tribal(1, 1, ['MURLOC']), tw('Giant_321'), vanilla(1, 1)], { hand: [vanilla(2, 3), vanilla(4, 5)] });
    startOfCombat(b);
    expect(board(b).map(stats)).toEqual([
      [7, 9],
      [8, 8],
      [1, 1],
    ]);
  });

  it('Hag: the Undead to the right is Reborn with full Health and its stats (golden: both neighbours)', () => {
    let b = ours([tribal(5, 9, ['UNDEAD']), tw('Giant_342'), tribal(5, 9, ['UNDEAD']), vanilla(1, 1)]);
    startOfCombat(b);
    expect(board(b).map((m) => m.reborn)).toEqual([false, false, true, false]);
    buff(b, board(b)[2], 2, 2);
    kill(b, board(b)[2]);
    expect(stats(board(b)[2])).toEqual([7, 11]);
    expect(board(b)[2].reborn).toBe(false);
    b = ours([tribal(5, 9, ['UNDEAD']), tw('Giant_342', true), tribal(5, 9, ['UNDEAD'])]);
    startOfCombat(b);
    expect(board(b).map((m) => m.reborn)).toEqual([true, false, true]);
    // A plain Reborn comes back with 1 Health.
    b = ours([tribal(5, 9, ['UNDEAD'], { reborn: true })]);
    kill(b, board(b)[0]);
    expect(board(b)[0].health).toBe(1);
  });

  it('Hawkstrider triggers all friendly Deathrattles (golden: twice)', () => {
    let b = ours([tw('Giant_370'), minion(BONEHEAD)]);
    startOfCombat(b);
    expect(ids(b)).toEqual(['BG34_Giant_370', BONEHEAD, SKELETON, SKELETON]);
    b = ours([tw('Giant_370', true), minion(BONEHEAD)]);
    startOfCombat(b);
    expect(board(b).length).toBe(6);
  });

  it('Ragnaros hits the highest-Health enemy for its Attack (golden: double)', () => {
    const enemies = () => side([vanilla(0, 5), vanilla(0, 100)]);
    let b = newBattle(battle(side([tw('Giant_580')]), enemies()));
    startOfCombat(b);
    expect(b.sides[1].board.map((m) => m.health)).toEqual([5, 92]);
    b = newBattle(battle(side([tw('Giant_580', true)]), enemies()));
    startOfCombat(b);
    expect(b.sides[1].board.map((m) => m.health)).toEqual([5, 68]);
  });

  it('Immortal gains the stats of adjacent minions (golden: double)', () => {
    let b = ours([vanilla(2, 3), tw('Giant_597'), vanilla(4, 5)]);
    startOfCombat(b);
    expect(stats(board(b)[1])).toEqual([14, 16]);
    b = ours([vanilla(2, 3), tw('Giant_597', true), vanilla(4, 5)]);
    startOfCombat(b);
    expect(stats(board(b)[1])).toEqual([28, 32]);
  });

  it('Whirl-O-Tron copies the two left-most Deathrattles with their script data', () => {
    // Plaguerunner (Undead +2 Attack this game) improved to +5 in its tags.
    const b = ours([
      minion(BONEHEAD),
      minion('BG34_690', { tags: { [SD1]: 5 } }),
      minion(BONEHEAD),
      tw('Giant_599'),
    ]);
    startOfCombat(b);
    const whirl = board(b)[3];
    expect(whirl.extraDeathrattles.length).toBe(2);
    kill(b, whirl);
    expect(ids(b).slice(3)).toEqual([SKELETON, SKELETON]);
    expect(b.sides[0].undeadAttackBonus).toBe(5);
    // Golden: each twice; other Whirl-O-Trons are skipped.
    const g = ours([tw('Giant_599'), minion(BONEHEAD), tw('Giant_599', true)]);
    startOfCombat(g);
    expect(board(g)[2].extraDeathrattles.length).toBe(2);
    expect(board(g)[0].extraDeathrattles.length).toBe(1);
  });

  it('Stoneshell copies friendly Rallies, keeping the golden-ness of their source', () => {
    // Golden Wolf Pup: Rally: Give your other minions +8/+2.
    const b = ours([minion('BG36_207', { golden: true }), tw('Giant_601'), vanilla(1, 1)]);
    startOfCombat(b);
    const [pup, shell, other] = board(b);
    const before = stats(pup);
    attackImmediately(b, shell, b.sides[1].board[0]);
    expect(stats(other)).toEqual([9, 3]);
    expect(stats(pup)).toEqual([before[0] + 8, before[1] + 2]);
    expect(stats(shell)).toEqual([4, 8]);
    // Without a Rally to copy it keeps the plain handler.
    const n = ours([tw('Giant_601'), vanilla(1, 1)]);
    startOfCombat(n);
    expect(board(n)[0].handler?.rally).toBeUndefined();
  });

  it('Mythrax gains the stats of friendly minions of different types', () => {
    const b = ours([tw('Giant_684'), tribal(2, 3, ['BEAST']), tribal(4, 5, ['DRAGON']), tribal(2, 3, ['BEAST']), vanilla(9, 9)]);
    startOfCombat(b);
    expect(stats(board(b)[0])).toEqual([14, 17]); // one Beast + the Dragon
    const g = ours([tw('Giant_684', true), tribal(2, 3, ['BEAST']), tw('Giant_684')]);
    startOfCombat(g);
    expect(stats(board(g)[0])).toEqual([20, 24]); // 16/18 + 2 x 2/3
  });

  it('Ultralisk cleaves and doubles its stats (golden: triples)', () => {
    let b = ours([tw('Treasure_994')]);
    startOfCombat(b);
    expect(stats(board(b)[0])).toEqual([16, 16]);
    expect(board(b)[0].cleave).toBe(true);
    b = ours([tw('Treasure_994', true)]);
    startOfCombat(b);
    expect(stats(board(b)[0])).toEqual([48, 48]);
  });
});

describe('Timewarped Avenge', () => {
  it('Geomancer (5) improves Blood Gems by +1/+1 (golden +2/+2)', () => {
    const b = ours([tw('Giant_305'), tw('Giant_305', true), ...[1, 2, 3, 4, 5].map(() => vanilla(1, 1))]);
    for (let i = 0; i < 4; i++) kill(b, board(b)[2]);
    expect(b.sides[0].bloodGemAttack).toBe(1);
    kill(b, board(b)[2]);
    expect([b.sides[0].bloodGemAttack, b.sides[0].bloodGemHealth]).toEqual([4, 4]);
  });

  it('Duskmaw (1) gives Dragons +6/+4', () => {
    const b = ours([tw('PreMadeChamp_020'), tribal(1, 1, ['DRAGON']), vanilla(1, 1), vanilla(1, 1)]);
    kill(b, board(b)[3]);
    expect(board(b).map(stats)).toEqual([
      [12, 18],
      [7, 5],
      [1, 1],
    ]);
  });
});

describe('Timewarped Rallies and attacks', () => {
  const attack = (b: Battle, m: Minion) => attackImmediately(b, m, b.sides[1].board[0]);

  it('Guard gives a different minion Divine Shield; Bonker plays 2 Blood Gems on the others', () => {
    const b = ours([tw('Giant_068'), tw('Giant_102'), vanilla(1, 1)]);
    const [guard, bonker, other] = board(b);
    attack(b, bonker);
    expect(stats(other)).toEqual([3, 3]);
    expect(stats(guard)).toEqual([7, 12]);
    expect(stats(bonker)).toEqual([7, 14]);
    attack(b, guard);
    expect([bonker.divineShield, other.divineShield].filter(Boolean).length).toBe(1);
    attack(b, guard);
    expect([bonker.divineShield, other.divineShield]).toEqual([true, true]);
  });

  it('Sea Glass doubles its stats twice per combat (golden: triples)', () => {
    let b = ours([tw('Giant_110')]);
    attack(b, board(b)[0]);
    expect(stats(board(b)[0])).toEqual([20, 16]);
    attack(b, board(b)[0]);
    attack(b, board(b)[0]);
    expect(stats(board(b)[0])).toEqual([40, 32]);
    b = ours([tw('Giant_110', true)]);
    attack(b, board(b)[0]);
    expect(stats(board(b)[0])).toEqual([60, 48]);
  });

  it('Collector cleaves and gains Divine Shield with 4 Golden minions', () => {
    const golden = () => minion(BONEHEAD, { golden: true });
    let b = ours([tw('Giant_680', true), golden(), golden()]);
    attack(b, board(b)[0]);
    expect([board(b)[0].cleave, board(b)[0].divineShield]).toEqual([true, false]);
    b = ours([tw('Giant_680', true), golden(), golden(), golden()]);
    attack(b, board(b)[0]);
    expect(board(b)[0].divineShield).toBe(true);
  });

  it('Viper is Immune while attacking, but not while defending', () => {
    const b = newBattle(battle(side([tw('Treasure_990')]), side([vanilla(5, 5), vanilla(5, 50)])));
    const viper = board(b)[0];
    const [first, second] = b.sides[1].board;
    attackImmediately(b, viper, first);
    expect(viper.health).toBe(8);
    expect(b.sides[1].board).toEqual([second]); // Venomous
    attackImmediately(b, second, viper);
    expect(viper.health).toBe(3);
  });

  it('Arm gives a friendly minion +8 Attack when it is attacked', () => {
    const b = newBattle(battle(side([tw('Giant_027'), vanilla(1, 10)]), side([vanilla(1, 100)])));
    const [arm, defender] = board(b);
    const enemy = b.sides[1].board[0];
    attackImmediately(b, enemy, defender);
    expect(stats(defender)).toEqual([9, 9]);
    expect(enemy.health).toBe(91);
    attackImmediately(b, enemy, arm);
    expect(arm.attack).toBe(16);
    // Our own attacks do not trigger it.
    attackImmediately(b, defender, enemy);
    expect(defender.attack).toBe(9);
  });

  it('Murcules buffs the left-most hand minion by +4/+4 on a kill', () => {
    const b = newBattle(
      battle(side([tw('Giant_207')], { hand: [vanilla(1, 1), vanilla(2, 2)] }), side([vanilla(1, 1), vanilla(1, 1)])),
    );
    attackImmediately(b, board(b)[0], b.sides[1].board[0]);
    expect(b.sides[0].hand.map(stats)).toEqual([
      [5, 5],
      [2, 2],
    ]);
  });

  it('Deios makes Rallies and Deathrattles trigger twice (golden: three times)', () => {
    let b = ours([tw('Giant_376'), tw('Giant_110'), minion(BONEHEAD)]);
    attack(b, board(b)[1]);
    expect(stats(board(b)[1])).toEqual([40, 32]); // both charges in one attack
    kill(b, board(b)[2]);
    expect(board(b).length).toBe(6);
    b = ours([tw('Giant_376', true), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(board(b).length).toBe(7);
    // No Deios: a Rally triggers once.
    b = ours([tw('Giant_110')]);
    attack(b, board(b)[0]);
    expect(stats(board(b)[0])).toEqual([20, 16]);
  });
});

describe('Timewarped damage / death / Divine Shield / Reborn triggers', () => {
  it('Piper improves Blood Gem Attack three times per combat', () => {
    const b = ours([tw('Giant_069')]);
    for (let i = 0; i < 4; i++) dealDamage(b, null, board(b)[0], 1);
    expect(b.sides[0].bloodGemAttack).toBe(4);
    const g = ours([tw('Giant_069', true)]);
    dealDamage(g, null, board(g)[0], 1);
    expect(g.sides[0].bloodGemAttack).toBe(3);
  });

  it('Deathswarmer gives Undead +1 Attack this game whenever it takes damage', () => {
    const b = ours([tw('Giant_081'), tribal(1, 1, ['UNDEAD']), vanilla(1, 1)]);
    dealDamage(b, null, board(b)[0], 1);
    expect(board(b).map(stats)).toEqual([
      [2, 8],
      [2, 1],
      [1, 1],
    ]);
    expect(b.sides[0].undeadAttackBonus).toBe(1);
  });

  it('Chimera gives a minion of each type +2/+1 when damaged (golden: twice)', () => {
    let b = ours([tw('Giant_679'), tribal(1, 1, ['BEAST']), tribal(1, 1, ['DRAGON']), vanilla(1, 1)]);
    dealDamage(b, null, board(b)[0], 1);
    expect(board(b).map(stats)).toEqual([
      [3, 8],
      [3, 2],
      [3, 2],
      [1, 1],
    ]);
    b = ours([tw('Giant_679', true), tribal(1, 1, ['BEAST'])]);
    dealDamage(b, null, board(b)[0], 1);
    expect(stats(board(b)[1])).toEqual([5, 3]);
  });

  it('Hyena gains +2/+2 when a friendly Beast dies', () => {
    const b = ours([tw('Giant_581'), tribal(1, 1, ['BEAST']), vanilla(1, 1)]);
    kill(b, board(b)[2]);
    expect(stats(board(b)[0])).toEqual([3, 5]);
    kill(b, board(b)[1]);
    expect(stats(board(b)[0])).toEqual([5, 7]);
  });

  it('Gemsplitter and Grease Bot react to a lost Divine Shield', () => {
    const b = ours([tw('Giant_644'), tw('Giant_656'), vanilla(1, 1, { divineShield: true })]);
    dealDamage(b, null, board(b)[2], 1);
    expect(b.sides[0].bloodGemAttack).toBe(2);
    expect(board(b).map(stats)).toEqual([
      [8, 13],
      [9, 15],
      [4, 4],
    ]);
  });

  it('Jelly Belly gives +2/+2 after a friendly Reborn', () => {
    const b = ours([tw('Giant_024'), vanilla(2, 2, { reborn: true })]);
    kill(b, board(b)[1]);
    expect(board(b).map(stats)).toEqual([
      [7, 8],
      [4, 3],
    ]);
  });

  it('Saurolisk and Ghoul-acabra react to triggered Deathrattles', () => {
    const b = ours([tw('Giant_202'), tw('Giant_609'), minion(BONEHEAD)]);
    kill(b, board(b)[2]);
    expect(board(b).map(stats)).toEqual([
      [10, 8], // 4/4 + 3/2 (own) + 3/2 (Ghoul-acabra)
      [9, 17],
      [4, 3],
      [4, 3],
    ]);
  });
});

describe('Timewarped summon triggers', () => {
  it('Embalmer gives Reborn to the first minion summoned (golden: two)', () => {
    let b = ours([tw('Giant_332'), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(board(b).map((m) => m.reborn)).toEqual([false, true, false]);
    b = ours([tw('Giant_332', true), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(board(b).map((m) => m.reborn)).toEqual([false, true, true]);
  });

  it('Tamuzo doubles summoned minions (golden: triples)', () => {
    let b = ours([tw('Giant_595'), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(board(b).slice(1).map(stats)).toEqual([
      [2, 2],
      [2, 2],
    ]);
    b = ours([tw('Giant_595', true), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(board(b).slice(1).map(stats)).toEqual([
      [3, 3],
      [3, 3],
    ]);
  });

  it('Deadstomper gives +4 Attack per summon; Jungle King gives summoned Beasts +4/+3', () => {
    let b = ours([tw('Giant_654'), minion(BONEHEAD)]);
    kill(b, board(b)[1]);
    expect(board(b).map(stats)).toEqual([
      [14, 12],
      [9, 1],
      [5, 1],
    ]);
    b = ours([tw('PreMadeChamp_004'), minion('BG31_803')]); // Buzzing Vermin: summon a 2/2 Beetle
    kill(b, board(b)[1]);
    expect(board(b).map(stats)).toEqual([
      [8, 12],
      [6, 5],
    ]);
  });

  it('Karathress adds cards to the hand per summon; Peggy buffs Pirates per card', () => {
    const b = ours([tw('PreMadeChamp_056'), tw('Giant_327'), tribal(1, 1, ['PIRATE']), minion(BONEHEAD)]);
    kill(b, board(b)[3]);
    expect(board(b).slice(1, 3).map(stats)).toEqual([
      [11, 7],
      [3, 3],
    ]);
    // Golden Peggy: twice per card; "Deathrattle: Get a card" minions count too.
    const g = ours([tw('Giant_327', true), tw('Giant_078')]);
    kill(g, board(g)[1]);
    expect(stats(board(g)[0])).toEqual([20, 12]);
  });
});

describe('Timewarped spell / Blood Gem / Magnetize / stat triggers', () => {
  it('Hooktail (+2/+2, golden twice), Nalaa (each type +4/+3) and Lab Rat (Beasts +2/+2)', () => {
    let b = ours([tw('Giant_015'), vanilla(1, 1)]);
    castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(board(b).map(stats)).toEqual([
      [8, 14],
      [3, 3],
    ]);
    b = ours([tw('Giant_015', true), vanilla(1, 1)]);
    castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(stats(board(b)[1])).toEqual([5, 5]);
    b = ours([tw('Giant_205'), tw('PreMadeChamp_002'), tribal(1, 1, ['DRAGON']), vanilla(1, 1)]);
    castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(board(b).map(stats)).toEqual([
      [12, 12],
      [18, 13], // 12/8 + 4/3 (Nalaa) + 2/2 (own)
      [5, 4],
      [1, 1],
    ]);
  });

  it('Twirler casts Blood Gem Barrage (a Tavern spell) when a Blood Gem is played on it', () => {
    const b = ours([tw('Giant_105'), tw('Giant_015')]);
    playBloodGem(b, board(b)[0]);
    expect(board(b).map(stats)).toEqual([
      [10, 8],
      [8, 14],
    ]);
    expect(b.sides[0].spellsCastThisCombat).toBe(1);
  });

  it('Electron magnetizes a 4/4 Satellite to all Mechs every 2 spells; Interpreter gives Mechs +3/+3', () => {
    const b = ours([tw('Giant_610'), tw('Giant_120'), vanilla(1, 1)]);
    castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(stats(board(b)[0])).toEqual([9, 9]);
    castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(board(b).map(stats)).toEqual([
      [19, 19], // 9/9 + 4/4 + 2 x 3/3
      [16, 18], // 6/8 + 4/4 + 2 x 3/3
      [1, 1],
    ]);
    castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(stats(board(b)[0])).toEqual([19, 19]);
  });

  it('Whelp Smuggler gives +3 Health whenever a friendly minion gains Attack', () => {
    const b = ours([tw('Giant_064'), vanilla(1, 1)]);
    buff(b, board(b)[1], 2, 0);
    expect(stats(board(b)[1])).toEqual([3, 4]);
    buff(b, board(b)[1], 0, 1);
    expect(stats(board(b)[1])).toEqual([3, 5]);
    buff(b, board(b)[0], 1, 1);
    expect(stats(board(b)[0])).toEqual([4, 12]);
    // Without a Smuggler the event is off.
    expect(ours([vanilla(1, 1)]).watchAttackGain).toBeFalsy();
  });

  it('Expeditioner passes gained stats to the two left-most hand minions (golden: twice)', () => {
    const hand = () => [vanilla(1, 1), vanilla(1, 1), vanilla(1, 1)];
    let b = ours([tw('Giant_317')], { hand: hand() });
    buff(b, board(b)[0], 2, 3);
    expect(b.sides[0].hand.map(stats)).toEqual([
      [3, 4],
      [3, 4],
      [1, 1],
    ]);
    b = ours([tw('Giant_317', true)], { hand: hand() });
    buff(b, board(b)[0], 2, 3);
    expect(b.sides[0].hand.map(stats)).toEqual([
      [5, 7],
      [5, 7],
      [1, 1],
    ]);
  });

  it('Lubber: its spell bonus leaves with it', () => {
    const b = ours([tw('Giant_066'), vanilla(1, 1)], {
      playerTags: { SIM_TAVERN_SPELL_ATTACK_BONUS: 1, SIM_TAVERN_SPELL_HEALTH_BONUS: 1 },
    });
    castSpell(b, b.sides[0], SHINY_RING);
    expect(stats(board(b)[1])).toEqual([3, 3]);
    kill(b, board(b)[0]);
    castSpell(b, b.sides[0], SHINY_RING);
    expect(stats(board(b)[0])).toEqual([4, 4]);
  });

  it('Centurion gets a copy of up to 3 spells (seen by Peggy)', () => {
    const b = ours([tw('PreMadeChamp_200'), tw('Giant_327')]);
    for (let i = 0; i < 5; i++) castSpell(b, b.sides[0], CHEFS_CHOICE);
    expect(stats(board(b)[1])).toEqual([12, 8]);
  });
});
