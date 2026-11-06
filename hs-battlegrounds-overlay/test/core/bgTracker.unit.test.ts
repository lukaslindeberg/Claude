import { describe, expect, it } from 'vitest';
import { CardDb } from '../../src/core/cards/cardDb';
import { BgTracker } from '../../src/core/bg';
import { fixtureLines, game, ofType, power } from './helpers';

/** Minimal header of a BG game (local player + dummy "innkeeper"). */
function bgHeader(gameTags: string[] = []): string[] {
  return [
    power('CREATE_GAME'),
    power('    GameEntity EntityID=13'),
    power('        tag=CARDTYPE value=GAME'),
    power('        tag=937 value=3459'),
    power('        tag=GAME_SEED value=1234'),
    ...gameTags.map((t) => power('        ' + t)),
    power('    Player EntityID=14 PlayerID=5 GameAccountId=[hi=144115198130930503 lo=38593682]'),
    power('        tag=PLAYER_ID value=5'),
    power('        tag=HERO_ENTITY value=33'),
    power('    Player EntityID=15 PlayerID=13 GameAccountId=[hi=0 lo=0]'),
    power('        tag=PLAYER_ID value=13'),
    power('        tag=BACON_DUMMY_PLAYER value=1'),
    game('BuildNumber=256589'),
    game('GameType=GT_BATTLEGROUNDS'),
    game('PlayerID=5, PlayerName=Me#1234'),
    game('PlayerID=13, PlayerName=The Innkeeper'),
  ];
}

function rankedGame(): string[] {
  return [
    power('CREATE_GAME'),
    power('    GameEntity EntityID=1'),
    power('        tag=CARDTYPE value=GAME'),
    power('    Player EntityID=2 PlayerID=1 GameAccountId=[hi=144115198130930503 lo=1]'),
    power('        tag=PLAYER_ID value=1'),
    power('    Player EntityID=3 PlayerID=2 GameAccountId=[hi=144115198130930503 lo=2]'),
    power('        tag=PLAYER_ID value=2'),
    game('GameType=GT_RANKED'),
    game('PlayerID=1, PlayerName=Me#1234'),
    game('PlayerID=2, PlayerName=Them#999'),
    power('FULL_ENTITY - Creating ID=4 CardID=HERO_01'),
    power('    tag=CARDTYPE value=HERO'),
    power('    tag=CONTROLLER value=1'),
    power('TAG_CHANGE Entity=GameEntity tag=TURN value=1 '),
    power('TAG_CHANGE Entity=Them tag=RESOURCES value=1 '),
  ];
}

describe('BgTracker (synthetic)', () => {
  it('starts idle', () => {
    const t = new BgTracker();
    const s = t.getState();
    expect(s.active).toBe(false);
    expect(s.phase).toBe('idle');
    expect(s.players).toEqual([]);
  });

  it('ignores non-BG games', () => {
    const t = new BgTracker();
    const v0 = t.version;
    const ev = t.feedLines(rankedGame());
    expect(ev).toEqual([]);
    const s = t.getState();
    expect(s.active).toBe(false);
    expect(s.phase).toBe('idle');
    expect(s.gameType).toBe('GT_RANKED');
    expect(t.version).toBe(v0);
  });

  it('detects BG, the anomaly and caches getState per version', () => {
    const db = CardDb.bundled();
    const anomaly = db.anomalies()[0];
    expect(anomaly).toBeDefined();
    const t = new BgTracker({ now: () => 42 });
    const ev = t.feedLines([...bgHeader([`tag=BACON_GLOBAL_ANOMALY_DBID value=${anomaly.dbfId}`, 'tag=BACON_QUESTS_ACTIVE value=1']), power('TAG_CHANGE Entity=GameEntity tag=STATE value=RUNNING ')]);
    expect(ofType(ev, 'gameStart')).toEqual([{ type: 'gameStart', gameId: 'bg-1234-42', mode: 'solo', gameType: 'GT_BATTLEGROUNDS', spectating: false }]);
    const s = t.getState();
    expect(s.active).toBe(true);
    expect(s.buildNumber).toBe(256589);
    expect(s.anomalyCardId).toBe(anomaly.id);
    expect(s.questsActive).toBe(true);
    expect(s.phase).toBe('heroSelection');
    expect(s.localPlayerName).toBe('Me#1234');
    expect(t.getState()).toBe(s); // cached
    const v = t.version;
    t.feedLine(power('TAG_CHANGE Entity=Me#1234 tag=RESOURCES value=3 '));
    expect(t.version).toBeGreaterThan(v);
    expect(t.getState()).not.toBe(s);
    // plain JSON
    expect(JSON.parse(JSON.stringify(t.getState()))).toEqual(t.getState());
  });

  it('detects BG without DebugPrintGame (dummy player) and spectator mode', () => {
    const t = new BgTracker();
    const lines = bgHeader().filter((l) => !l.includes('DebugPrintGame'));
    const ev = t.feedLines(['D 12:00:00.0000000 Spectator.Begin Spectating', ...lines, power('TAG_CHANGE Entity=GameEntity tag=STATE value=RUNNING ')]);
    expect(ofType(ev, 'gameStart')).toHaveLength(1);
    expect(ofType(ev, 'gameStart')[0].spectating).toBe(true);
    expect(t.getState().active).toBe(true);
    expect(t.getState().spectating).toBe(true);
    expect(t.getState().gameType).toBe('GT_BATTLEGROUNDS');
    t.feedLine('D 12:10:00.0000000 Spectator.End Spectator mode');
    expect(t.getState().spectating).toBe(false);
  });

  it('tracks several games in one log (reset on CREATE_GAME)', () => {
    const lines = [
      ...fixtureLines('bg_kelthuzad_37060.power.log.gz'),
      ...rankedGame(),
      ...fixtureLines('bg_zero_turn_37060.power.log.gz'),
      ...fixtureLines('bg_conceded_turn3_37060.power.log.gz'),
    ];
    const t = new BgTracker({ now: () => 0 });
    const ev = [...t.feedLines(lines), ...t.flush()];
    expect(ofType(ev, 'gameStart')).toHaveLength(3);
    const ends = ofType(ev, 'gameEnd');
    expect(ends.map((e) => [e.record.heroCardId, e.record.placement, e.record.combats.length])).toEqual([
      ['TB_BaconShop_HERO_42', 6, 4],
      ['TB_BaconShop_HERO_12', 8, 0],
      ['TB_BaconShop_HERO_36', 8, 2],
    ]);
    const s = t.getState();
    expect(s.active).toBe(true);
    expect(s.localPlayerName).toBe('Almur45#21408');
    expect(s.finalPlacement).toBe(8);
    // a trailing ranked game turns the tracker inactive again
    t.feedLines(rankedGame());
    expect(t.getState().active).toBe(false);
  });

  it('reset() clears everything', () => {
    const t = new BgTracker();
    t.feedLines(fixtureLines('bg_zero_turn_37060.power.log.gz'));
    expect(t.getState().active).toBe(true);
    t.reset();
    expect(t.getState().active).toBe(false);
    // and can track again afterwards
    t.feedLines(fixtureLines('bg_zero_turn_37060.power.log.gz'));
    expect(t.getState().chosenHeroCardId).toBe('TB_BaconShop_HERO_12');
  });

  it('reset({ keepUnfinishedGame }) lets a reconnect in a new log continue the game', () => {
    let now = 1000;
    const running = power('TAG_CHANGE Entity=GameEntity tag=STATE value=RUNNING ');
    const t = new BgTracker({ now: () => now++ });
    const ev1 = t.feedLines([...bgHeader(), running]);
    expect(ofType(ev1, 'gameStart')).toHaveLength(1);
    const id = t.getState().gameId;
    // Client restarted: new Power.log in a new session folder.
    t.reset({ keepUnfinishedGame: true });
    expect(t.getState().active).toBe(false);
    t.reset({ keepUnfinishedGame: true }); // e.g. switched, then truncated: still remembered
    const ev2 = t.feedLines([...bgHeader(), running]);
    expect(ofType(ev2, 'gameStart')).toHaveLength(0);
    expect(t.getState().active).toBe(true);
    expect(t.getState().gameId).toBe(id);

    // A plain reset forgets the game: the same lines start a new one.
    t.reset();
    const ev3 = t.feedLines([...bgHeader(), running]);
    expect(ofType(ev3, 'gameStart')).toHaveLength(1);
    expect(t.getState().gameId).not.toBe(id);
  });

  it('reset({ keepUnfinishedGame }) does not resume a finished game', () => {
    const lines = fixtureLines('bg_kelthuzad_37060.power.log.gz');
    const t = new BgTracker();
    t.feedLines(lines);
    expect(t.getState().phase).toBe('gameOver');
    t.reset({ keepUnfinishedGame: true });
    const ev = t.feedLines(lines);
    expect(ofType(ev, 'gameStart')).toHaveLength(1);
  });

  it('emits a pending gameEnd on flush when the log stops before STATE=COMPLETE', () => {
    const lines = fixtureLines('bg_kelthuzad_37060.power.log.gz');
    const cut = lines.findIndex((l) => l.includes('tag=STATE value=COMPLETE'));
    expect(cut).toBeGreaterThan(0);
    const t = new BgTracker();
    const ev = t.feedLines(lines.slice(0, cut));
    expect(ofType(ev, 'gameEnd')).toHaveLength(0);
    expect(t.getState().phase).toBe('gameOver');
    expect(t.getState().finalPlacement).toBe(6);
    const end = t.flush();
    expect(ofType(end, 'gameEnd')).toHaveLength(1);
    expect(ofType(end, 'gameEnd')[0].record.placement).toBe(6);
  });
});
