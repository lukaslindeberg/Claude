/**
 * Findings from replaying real combats (Power.log + tracker snapshots): "this game" values that only live
 * on enchantments / player tags, and Tasty Lobster improving itself during combat.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '../../src/core/sim';
import { ensureCardsRegistered } from '../../src/core/sim/cards';
import { createBattle } from '../../src/core/sim/engine/battle';
import { resolveDeaths } from '../../src/core/sim/engine/deaths';
import { Rng } from '../../src/core/sim/engine/rng';
import type { BattleSimInput, MinionSnapshot } from '@shared/types';
import { battle, db, minion, side, vanilla } from './helpers';

ensureCardsRegistered();

function withEnchant(m: MinionSnapshot, cardId: string, scriptData1?: number, scriptData2?: number): MinionSnapshot {
  m.enchantments = [...(m.enchantments ?? []), { entityId: m.entityId * 100 + 50, cardId, scriptData1, scriptData2 }];
  return m;
}

function killFirst(input: BattleSimInput) {
  const b = createBattle(input, db, new Rng(1));
  b.sides[0].board[0].health = 0;
  resolveDeaths(b);
  return b;
}

const dummy = () => side([vanilla(0, 1000)]);

describe('Undead "this game" bonuses read from enchantments', () => {
  it('Undead Army (BG25_011e2) script data is the Attack bonus of Undead summoned in combat', () => {
    const hf = withEnchant(minion('BG25_010', { attack: 9 }), 'BG25_011e2', 7);
    const b = killFirst(battle(side([hf]), dummy()));
    // Handless Forsaken's 2/1 Hand is an Undead: +7 Attack.
    expect(b.sides[0].board.map((m) => [m.name, m.attack, m.health])).toEqual([['Helping Hand', 9, 1]]);
  });

  it('an explicit SIM_UNDEAD_ATTACK_BONUS player tag wins over the enchantment', () => {
    const hf = withEnchant(minion('BG25_010', { attack: 9 }), 'BG25_011e2', 7);
    const b = killFirst(battle(side([hf], { playerTags: { SIM_UNDEAD_ATTACK_BONUS: 1 } }), dummy()));
    expect(b.sides[0].board[0].attack).toBe(3);
  });

  it('Eternal Legion (BG25_008_e) gives the knights-dead count to Eternal Knights summoned in combat', () => {
    // A golden knight with +224/+112 (8/4 per death) => 28 knights died this game.
    const knight = withEnchant(minion('BG25_008', { golden: true, attack: 232, health: 116, tags: { TAG_SCRIPT_DATA_NUM_1: 8, TAG_SCRIPT_DATA_NUM_2: 4 } }), 'BG25_008_e', 224, 112);
    const summoner = minion('BG25_009', { keywords: { reborn: false } });
    const b = killFirst(battle(side([summoner, knight]), dummy()));
    const summoned = b.sides[0].board.find((m) => m.cardId === 'BG25_008')!;
    expect([summoned.attack, summoned.health]).toEqual([4 + 4 * 28, 2 + 2 * 28]);
  });

  it('a Reborn Eternal Knight keeps its "wherever this is" Health bonus on top of 1 Health', () => {
    const knight = withEnchant(minion('BG25_008', { attack: 44, health: 22, keywords: { reborn: true } }), 'BG25_008_e', 40, 20);
    const b = killFirst(battle(side([knight]), dummy()));
    const [m] = b.sides[0].board;
    // 10 died before + itself = 11: 4 + 44 / 1 + 22.
    expect([m.cardId, m.attack, m.health, m.reborn]).toEqual(['BG25_008', 48, 23, false]);
  });
});

describe('Tasty Lobster improves during combat', () => {
  it('each trigger gives 2/1 x (improves + 1) and improves the next one (player tag 4803)', () => {
    const lobster = minion('BG36_202');
    const beast = vanilla(1, 1);
    beast.tribes = ['BEAST'];
    const b = killFirst(battle(side([lobster, beast, minion('BG25_354')], { playerTags: { '4803': 9 } }), dummy()));
    // Titus: two triggers, +20/+10 then +22/+11.
    expect([b.sides[0].board[0].attack, b.sides[0].board[0].health]).toEqual([43, 22]);
    expect(b.sides[0].tastyLobsterImproves).toBe(11);
  });

  it('without the player tag the count comes from the Lobster script data (golden doubled)', () => {
    const lobster = minion('BG36_202', { golden: true, tags: { TAG_SCRIPT_DATA_NUM_1: 48, TAG_SCRIPT_DATA_NUM_2: 24 } });
    const beast = vanilla(1, 1);
    beast.tribes = ['BEAST'];
    const b = killFirst(battle(side([lobster, beast]), dummy()));
    // 48 = 4 x (11 + 1): the trigger gives 4/2 x 12.
    expect([b.sides[0].board[0].attack, b.sides[0].board[0].health]).toEqual([49, 25]);
  });
});

interface RealCombat {
  name: string;
  mode: string;
  result: 'won' | 'lost' | 'tied';
  input: BattleSimInput;
}

describe('real combats (anonymised tracker inputs)', () => {
  const cases = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/real-combats.json'), 'utf8')) as RealCombat[];
  it.each(cases.map((c) => [c.name, c] as const))('%s: the actual result is likely', (_name, c) => {
    const r = simulateBattle(c.input, { iterations: 400, seed: 3, maxDurationMs: 60_000 });
    const p = c.result === 'won' ? r.win : c.result === 'lost' ? r.loss : r.tie;
    expect(r.unsupported).toEqual([]);
    expect(p).toBeGreaterThan(40);
  });
});
