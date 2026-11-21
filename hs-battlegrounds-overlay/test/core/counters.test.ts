import { describe, expect, it } from 'vitest';
import { BgTracker } from '../../src/core/bg';
import { fixtureLines, game, power } from './helpers';

const DUOS = 'bg_duos_aberrations_deity_2026.power.log.gz';

/** State after feeding the first `n` lines of a fixture. */
function stateAt(file: string, stops: number[]): Map<number, ReturnType<BgTracker['getState']>> {
  const t = new BgTracker({ now: () => 1 });
  const lines = fixtureLines(file);
  const out = new Map<number, ReturnType<BgTracker['getState']>>();
  const want = new Set(stops);
  for (let i = 0; i < lines.length && out.size < want.size; i++) {
    t.feedLine(lines[i]);
    if (want.has(i + 1)) out.set(i + 1, t.getState());
  }
  return out;
}

describe('local counters (fixture)', () => {
  it('reads free refreshes from the Refresh button and a Blood Gem chip once Quilboars show up', () => {
    const at = stateAt(DUOS, [40001, 49300, 49970, 51300, 130001, 163690, 164300, 165750]);
    // Turn 5: nothing to show.
    expect(at.get(40001)!.counters).toBeUndefined();
    // Turn 6: BACON_FREE_REFRESH_COUNT 2 -> 1 -> 0 on the Refresh button.
    expect(at.get(49300)!.counters).toEqual({ freeRefreshes: 2 });
    expect(at.get(49970)!.counters).toEqual({ freeRefreshes: 1 });
    expect(at.get(51300)!.counters).toBeUndefined();
    // Turn 9: Quilboar / Blood Gem cards on board, gems still give the base +1/+1.
    expect(at.get(130001)!.counters).toEqual({ bloodGem: { attack: 1, health: 1 } });
    // Turn 10: a second round of free refreshes; the Blood Gem chip stays.
    expect(at.get(163690)!.counters).toEqual({ bloodGem: { attack: 1, health: 1 }, freeRefreshes: 2 });
    expect(at.get(164300)!.counters?.freeRefreshes).toBe(1);
    expect(at.get(165750)!.counters).toEqual({ bloodGem: { attack: 1, health: 1 } });
  });

  it('ignores the opponent Blood Gem values copied onto Bartender Bob in combat', () => {
    // Line 141566: Bob gets BACON_BLOODGEMBUFFHEALTHVALUE=10 (opponent's gems).
    const at = stateAt(DUOS, [141566]);
    expect(at.get(141566)!.counters?.bloodGem).toEqual({ attack: 1, health: 1 });
  });
});

function header(): string[] {
  return [
    power('CREATE_GAME'),
    power('    GameEntity EntityID=13'),
    power('        tag=CARDTYPE value=GAME'),
    power('        tag=GAME_SEED value=1234'),
    power('    Player EntityID=14 PlayerID=5 GameAccountId=[hi=144115198130930503 lo=38593682]'),
    power('        tag=PLAYER_ID value=5'),
    power('        tag=HERO_ENTITY value=33'),
    power('    Player EntityID=15 PlayerID=13 GameAccountId=[hi=0 lo=0]'),
    power('        tag=PLAYER_ID value=13'),
    power('        tag=BACON_DUMMY_PLAYER value=1'),
    game('GameType=GT_BATTLEGROUNDS'),
    game('PlayerID=5, PlayerName=Me#1234'),
    game('PlayerID=13, PlayerName=The Innkeeper'),
    power('TAG_CHANGE Entity=GameEntity tag=STATE value=RUNNING '),
    power('TAG_CHANGE Entity=GameEntity tag=TURN value=3 '),
  ];
}

/** Any following packet closes a pending FULL_ENTITY block. */
const END = power('TAG_CHANGE Entity=GameEntity tag=TURN value=3 ');

function minion(id: number, cardId: string, zone: string, extra: string[] = []): string[] {
  return [
    power(`FULL_ENTITY - Creating ID=${id} CardID=${cardId}`),
    power('    tag=CONTROLLER value=5'),
    power('    tag=CARDTYPE value=MINION'),
    power(`    tag=ZONE value=${zone}`),
    ...extra.map((x) => power('    ' + x)),
    END,
  ];
}

describe('local counters (synthetic)', () => {
  it('shows nothing by default', () => {
    const t = new BgTracker();
    t.feedLines(header());
    expect(t.getState().counters).toBeUndefined();
  });

  it('Blood Gem stats from the player tags (base +1/+1 added)', () => {
    const t = new BgTracker();
    t.feedLines([...header(), power('TAG_CHANGE Entity=Me#1234 tag=BACON_BLOODGEMBUFFATKVALUE value=2 '), power('TAG_CHANGE Entity=Me#1234 tag=BACON_BLOODGEMBUFFHEALTHVALUE value=3 ')]);
    expect(t.getState().counters).toEqual({ bloodGem: { attack: 3, health: 4 } });
  });

  it('Blood Gem chip at the default +1/+1 when a Quilboar is on the board', () => {
    const t = new BgTracker();
    t.feedLines([...header(), ...minion(40, 'BG20_101', 'PLAY')]); // Razorfen Geomancer (Quilboar)
    expect(t.getState().counters).toEqual({ bloodGem: { attack: 1, health: 1 } });
  });

  it('Beetle stats from the beetle cards script data, 2/2 by default', () => {
    const t = new BgTracker();
    t.feedLines([...header(), ...minion(41, 'BG31_803', 'HAND', ['tag=TAG_SCRIPT_DATA_NUM_1 value=2', 'tag=TAG_SCRIPT_DATA_NUM_2 value=2'])]);
    expect(t.getState().counters).toEqual({ beetle: { attack: 2, health: 2 } });
    t.feedLines([
      ...minion(42, 'BG31_801', 'PLAY', ['tag=TAG_SCRIPT_DATA_NUM_1 value=2', 'tag=TAG_SCRIPT_DATA_NUM_2 value=2']),
      power('TAG_CHANGE Entity=42 tag=TAG_SCRIPT_DATA_NUM_1 value=5 '),
      power('TAG_CHANGE Entity=42 tag=TAG_SCRIPT_DATA_NUM_2 value=6 '),
      power('TAG_CHANGE Entity=41 tag=ZONE value=GRAVEYARD '),
      power('TAG_CHANGE Entity=42 tag=ZONE value=GRAVEYARD '),
    ]);
    // Sticky for the rest of the game once beetles were involved.
    expect(t.getState().counters).toEqual({ beetle: { attack: 5, health: 6 } });
  });

  it('extra and overdrawn gold next turn, free refreshes', () => {
    const t = new BgTracker();
    t.feedLines([
      ...header(),
      power('TAG_CHANGE Entity=Me#1234 tag=BACON_PLAYER_EXTRA_GOLD_NEXT_TURN value=2 '),
      power('TAG_CHANGE Entity=Me#1234 tag=BACON_PLAYER_OVERDRAWN_GOLD_NEXT_TURN value=1 '),
      power('FULL_ENTITY - Creating ID=50 CardID=TB_BaconShop_8p_Reroll_Button'),
      power('    tag=CONTROLLER value=5'),
      power('    tag=ZONE value=PLAY'),
      power('    tag=BACON_FREE_REFRESH_COUNT value=3'),
      END,
    ]);
    expect(t.getState().counters).toEqual({ extraGoldNextTurn: 2, overdrawnGoldNextTurn: 1, freeRefreshes: 3 });
    t.feedLines([power('TAG_CHANGE Entity=Me#1234 tag=BACON_PLAYER_EXTRA_GOLD_NEXT_TURN value=0 '), power('TAG_CHANGE Entity=Me#1234 tag=BACON_PLAYER_OVERDRAWN_GOLD_NEXT_TURN value=0 '), power('TAG_CHANGE Entity=50 tag=BACON_FREE_REFRESH_COUNT value=0 ')]);
    expect(t.getState().counters).toBeUndefined();
  });
});
