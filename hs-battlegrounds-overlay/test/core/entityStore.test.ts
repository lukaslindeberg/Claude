import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/core/game/entityStore';
import { GameTag } from '../../src/core/log/enums';
import { parsePowerLog } from '../../src/core/log/powerLogParser';
import { game, power } from './helpers';

function bgStore(withDebugNames = true): EntityStore {
  const s = new EntityStore();
  const lines = [
    power('CREATE_GAME'),
    power('    GameEntity EntityID=13'),
    power('        tag=CARDTYPE value=GAME'),
    power('    Player EntityID=14 PlayerID=5 GameAccountId=[hi=144115198130930503 lo=38593682]'),
    power('        tag=PLAYER_ID value=5'),
    power('    Player EntityID=15 PlayerID=13 GameAccountId=[hi=0 lo=0]'),
    power('        tag=PLAYER_ID value=13'),
    power('        tag=BACON_DUMMY_PLAYER value=1'),
  ];
  if (withDebugNames) lines.push(game('PlayerID=5, PlayerName=MuNGGG#2882'), game('PlayerID=13, PlayerName=The Innkeeper'));
  for (const pk of parsePowerLog(lines)) s.apply(pk);
  return s;
}

describe('EntityStore', () => {
  it('identifies the local and dummy players', () => {
    const s = bgStore();
    expect(s.localPlayer?.entityId).toBe(14);
    expect(s.dummyPlayer?.entityId).toBe(15);
    expect(s.localPlayer?.name).toBe('MuNGGG#2882');
    expect(s.playerByController(13)?.entityId).toBe(15);
  });

  it('maps every non-local name to the BG dummy player (Bob skins, opponent names)', () => {
    const s = bgStore();
    const seen: Array<[number, string]> = [];
    s.onNameResolved = (id, n) => seen.push([id, n]);
    for (const pk of parsePowerLog([
      power('TAG_CHANGE Entity=Ragnaros, Tikilord tag=RESOURCES value=2 '),
      power('TAG_CHANGE Entity=LadyGagaFTW tag=HERO_ENTITY value=58 '),
      power('TAG_CHANGE Entity=MuNGGG#2882 tag=RESOURCES value=3 '),
      power('TAG_CHANGE Entity=Таверна Боба tag=NUM_TURNS_IN_PLAY value=1 '),
    ]))
      s.apply(pk);
    expect(s.tag(15, GameTag.RESOURCES)).toBe(2);
    expect(s.tag(15, GameTag.HERO_ENTITY)).toBe(58);
    expect(s.tag(14, GameTag.RESOURCES)).toBe(3);
    expect(s.tag(15, GameTag.NUM_TURNS_IN_PLAY)).toBe(1);
    expect([...s.dummyPlayer!.aliases]).toEqual(expect.arrayContaining(['The Innkeeper', 'Ragnaros, Tikilord', 'LadyGagaFTW', 'Таверна Боба']));
    // the dummy keeps its DebugPrintGame name as primary name
    expect(s.dummyPlayer!.name).toBe('The Innkeeper');
    expect(seen).toEqual([
      [15, 'Ragnaros, Tikilord'],
      [15, 'LadyGagaFTW'],
      [14, 'MuNGGG#2882'],
      [15, 'Таверна Боба'],
    ]);
  });

  it('without DebugPrintGame: BattleTag-looking names go to the local player, others to the dummy', () => {
    const s = bgStore(false);
    for (const pk of parsePowerLog([
      power('TAG_CHANGE Entity=Bartender Bob tag=RESOURCES value=1 '),
      power('TAG_CHANGE Entity=Someone#1234 tag=RESOURCES value=7 '),
    ]))
      s.apply(pk);
    expect(s.tag(15, GameTag.RESOURCES)).toBe(1);
    expect(s.tag(14, GameTag.RESOURCES)).toBe(7);
    expect(s.localPlayer?.name).toBe('Someone#1234');
  });

  it('entity choices resolve their player name to the local player', () => {
    const s = bgStore(false);
    for (const pk of parsePowerLog([
      'D 1:00:00.0 GameState.DebugPrintEntityChoices() - id=1 Player=Lovely Name TaskList=6 ChoiceType=MULLIGAN CountMin=1 CountMax=1',
      'D 1:00:00.0 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=X id=91 zone=HAND zonePos=1 cardId=TB_BaconShop_HERO_67 player=5]',
      power('TAG_CHANGE Entity=Lovely Name tag=RESOURCES value=4 '),
    ]))
      s.apply(pk);
    expect(s.localPlayer?.name).toBe('Lovely Name');
    expect(s.tag(14, GameTag.RESOURCES)).toBe(4);
  });

  it('in a regular 2-player game assigns an unknown name to the unnamed player', () => {
    const s = new EntityStore();
    for (const pk of parsePowerLog([
      power('CREATE_GAME'),
      power('    GameEntity EntityID=1'),
      power('    Player EntityID=2 PlayerID=1 GameAccountId=[hi=1 lo=1]'),
      power('    Player EntityID=3 PlayerID=2 GameAccountId=[hi=1 lo=2]'),
      game('PlayerID=1, PlayerName=Me#1'),
      power('TAG_CHANGE Entity=Them tag=RESOURCES value=5 '),
    ]))
      s.apply(pk);
    expect(s.tag(3, GameTag.RESOURCES)).toBe(5);
  });

  it('tracks tags, show/hide/change entity and entity names from refs', () => {
    const s = bgStore();
    const changes: Array<[number, number, number, number]> = [];
    s.onTagChange = (e, t, p, v) => changes.push([e.id, t, p, v]);
    for (const pk of parsePowerLog([
      power('FULL_ENTITY - Creating ID=270 CardID='),
      power('    tag=ZONE value=SETASIDE'),
      power('SHOW_ENTITY - Updating Entity=270 CardID=BGS_061'),
      power('    tag=ZONE value=PLAY'),
      power('    tag=ATK value=3'),
      power('TAG_CHANGE Entity=[entityName=Scallywag id=270 zone=PLAY zonePos=2 cardId=BGS_061 player=13] tag=ATK value=4 '),
      power('CHANGE_ENTITY - Updating Entity=270 CardID=TB_BaconUps_141'),
      power('HIDE_ENTITY - Entity=270 tag=ZONE value=GRAVEYARD'),
    ]))
      s.apply(pk);
    const e = s.get(270)!;
    expect(e.cardId).toBe('TB_BaconUps_141');
    expect(e.name).toBe('Scallywag');
    expect(e.tags.get(GameTag.ATK)).toBe(4);
    expect(e.tags.get(GameTag.ZONE)).toBe(4);
    expect(changes).toEqual([
      [270, GameTag.ZONE, 6, 1],
      [270, GameTag.ATK, 0, 3],
      [270, GameTag.ATK, 3, 4],
      [270, GameTag.ZONE, 1, 4],
    ]);
  });
});
