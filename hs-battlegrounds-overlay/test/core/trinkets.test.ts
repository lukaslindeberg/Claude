import { describe, expect, it } from 'vitest';
import type { BgGameState, MatchRecord } from '@shared/types';
import { BgTracker } from '../../src/core/bg';
import { fixtureLines } from './helpers';

interface Seen {
  /** trinketOptions right after each trinket EntityChoices line, with the BG turn. */
  offers: { turn: number; options: { cardId: string; cost?: number }[] }[];
  /** trinketOptions right after each EntitiesChosen line. */
  afterPick: (BgGameState['trinketOptions'] | undefined)[];
  record?: MatchRecord;
  final: BgGameState;
}

function run(file: string): Seen {
  const t = new BgTracker({ now: () => 1_700_000_000_000 });
  const seen: Seen = { offers: [], afterPick: [], final: t.getState() };
  // Multi-line packets complete on the line after their last entity line.
  let pendingOffer = false;
  let pendingPick = false;
  for (const line of fixtureLines(file)) {
    for (const e of t.feedLine(line)) if (e.type === 'gameEnd') seen.record = e.record;
    if (pendingOffer) {
      const st = t.getState();
      if (st.trinketOptions) {
        seen.offers.push({ turn: st.turn, options: st.trinketOptions.map((o) => ({ cardId: o.cardId, cost: o.cost })) });
        pendingOffer = false;
      }
    }
    if (pendingPick && !/DebugPrintEntitiesChosen\(\) -\s+Entities/.test(line)) {
      seen.afterPick.push(t.getState().trinketOptions);
      pendingPick = false;
    }
    if (/GameState\.DebugPrintEntityChoices\(\) - id=/.test(line)) pendingOffer = true;
    else if (/GameState\.DebugPrintEntitiesChosen\(\) - id=/.test(line)) {
      pendingOffer = false;
      pendingPick = true;
    }
  }
  for (const e of t.flush()) if (e.type === 'gameEnd') seen.record = e.record;
  seen.final = t.getState();
  return seen;
}

describe('trinket offers and picks', () => {
  it('duos trinkets 206605: lesser offer on turn 6, greater on turn 9, four options each', () => {
    const r = run('bg_duos_trinkets_206605.power.log.gz');
    expect(r.offers).toEqual([
      {
        turn: 6,
        options: [
          { cardId: 'BG30_MagicItem_803', cost: 1 }, // Kaboom Bot Portrait
          { cardId: 'BG30_MagicItem_416', cost: 1 }, // Token of the Old Gods
          { cardId: 'BG30_MagicItem_426', cost: 3 }, // Colorful Compass
          { cardId: 'BG30_MagicItem_998', cost: 0 }, // Bob-blehead
        ],
      },
      {
        turn: 9,
        options: [
          { cardId: 'BG30_MagicItem_420t', cost: 5 }, // Book of Medivh
          { cardId: 'BG30_MagicItem_422t', cost: 2 }, // Lorewalker Scroll
          { cardId: 'BG30_MagicItem_543', cost: 2 }, // Devourer Sticker
          { cardId: 'BG30_MagicItem_916', cost: 1 }, // Essence of Dreams
        ],
      },
    ]);
    // Every choice closes the offer (the 3rd/4th choices are a triple reward and discovers).
    expect(r.afterPick).toHaveLength(6);
    expect(r.afterPick.every((o) => o === undefined)).toBe(true);
    expect(r.record?.trinkets).toEqual(['BG30_MagicItem_426', 'BG30_MagicItem_422t']);
    expect(r.record?.questRewards).toBeUndefined();
    expect(r.final.trinketOptions).toBeUndefined();
  });

  it('duos aberrations 2026: picks Corrupted Coin Portrait and Sphere of Memory', () => {
    const r = run('bg_duos_aberrations_deity_2026.power.log.gz');
    expect(r.offers.map((o) => [o.turn, o.options.map((x) => x.cardId)])).toEqual([
      [6, ['BG36_MagicItem_403', 'BGDUO_MagicItem_003', 'BG30_MagicItem_425', 'BG36_MagicItem_400']],
      [9, ['BG35_MagicItem_931t', 'BG36_MagicItem_372', 'BG36_MagicItem_602', 'BG36_MagicItem_403t']],
    ]);
    expect(r.record?.trinkets).toEqual(['BG36_MagicItem_400', 'BG36_MagicItem_372']);
  });

  it('records quest rewards; games without trinkets have no trinket fields', () => {
    const q = run('bg_quests_150659.power.log.gz');
    expect(q.offers).toEqual([]);
    expect(q.record?.questRewards).toEqual(['BG24_Reward_130']);
    expect(q.record?.trinkets).toBeUndefined();
    const p = run('bg_139963_perfect_game.power.log.gz');
    expect(p.record?.trinkets).toBeUndefined();
    expect(p.record?.questRewards).toBeUndefined();
  });
});
