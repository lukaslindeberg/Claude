import { describe, expect, it } from 'vitest';
import { CardType, GameTag, Mulligan, PlayState, Race, Step, Zone } from '../../src/core/log/enums';
import {
  PowerLogParser,
  parseEntityRef,
  parsePowerLog,
  tagId,
  tagName,
  tagValue,
  type Packet,
} from '../../src/core/log/powerLogParser';
import { fixtureLines } from './helpers';

const L = (s: string, src = 'GameState') => `D 13:18:11.0621247 ${src}.DebugPrintPower() - ${s}`;

function one<T extends Packet['type']>(lines: string[], type: T): Extract<Packet, { type: T }> {
  const pk = parsePowerLog(lines).filter((p) => p.type === type);
  expect(pk.length).toBe(1);
  return pk[0] as Extract<Packet, { type: T }>;
}

describe('entity refs', () => {
  it('parses GameEntity, bare ids and player names', () => {
    expect(parseEntityRef('GameEntity')).toEqual({ kind: 'game' });
    expect(parseEntityRef('268')).toEqual({ kind: 'id', id: 268 });
    expect(parseEntityRef('MuNGGG#2882')).toEqual({ kind: 'name', name: 'MuNGGG#2882' });
    // display names with spaces and commas (Bob skins), unicode
    expect(parseEntityRef('Ragnaros, Tikilord')).toEqual({ kind: 'name', name: 'Ragnaros, Tikilord' });
    expect(parseEntityRef('皮皮珍美美哒#5256')).toEqual({ kind: 'name', name: '皮皮珍美美哒#5256' });
    expect(parseEntityRef("Bob's Tavern")).toEqual({ kind: 'name', name: "Bob's Tavern" });
    // a name that starts with a digit is still a name
    expect(parseEntityRef('42isTheAnswer')).toEqual({ kind: 'name', name: '42isTheAnswer' });
  });

  it('parses bracketed refs incl. names with commas, brackets and unicode', () => {
    expect(parseEntityRef('[entityName=Icky Imp id=268 zone=PLAY zonePos=1 cardId=BG21_029 player=5]')).toEqual({
      kind: 'id',
      name: 'Icky Imp',
      id: 268,
      zone: 'PLAY',
      zonePos: 1,
      cardId: 'BG21_029',
      player: 5,
    });
    const bob = parseEntityRef('[entityName=Ragnaros, Tikilord id=58 zone=PLAY zonePos=0 cardId=TB_BaconShopBob_SKIN_A player=13]');
    expect(bob).toMatchObject({ kind: 'id', id: 58, name: 'Ragnaros, Tikilord', cardId: 'TB_BaconShopBob_SKIN_A', player: 13 });
    const unk = parseEntityRef('[entityName=UNKNOWN ENTITY [cardType=INVALID] id=342 zone=SETASIDE zonePos=0 cardId= player=5]');
    expect(unk).toMatchObject({ kind: 'id', id: 342, name: 'UNKNOWN ENTITY [cardType=INVALID]', zone: 'SETASIDE', player: 5 });
    expect(unk.cardId).toBeUndefined();
    const dnt = parseEntityRef('[entityName=Persistent Poet Player Enchant [DNT] id=215 zone=PLAY zonePos=0 cardId=BG29_813e player=2]');
    expect(dnt).toMatchObject({ id: 215, name: 'Persistent Poet Player Enchant [DNT]', cardId: 'BG29_813e' });
    expect(parseEntityRef("[entityName=Kel'Thuzad id=57 zone=SETASIDE zonePos=0 cardId=TB_BaconShop_HERO_KelThuzad player=5]")).toMatchObject({
      id: 57,
      name: "Kel'Thuzad",
    });
    expect(parseEntityRef('[entityName=Таверна Боба id=66 zone=PLAY zonePos=0 cardId=TB_BaconShopBob player=15]')).toMatchObject({
      id: 66,
      name: 'Таверна Боба',
    });
    // old format
    expect(parseEntityRef('[name=Foo id=4 zone=DECK zonePos=0 cardId=X player=1]')).toMatchObject({ id: 4, name: 'Foo', cardId: 'X' });
    expect(parseEntityRef('[id=5 cardId= type=INVALID zone=DECK zonePos=0 player=1]')).toMatchObject({ kind: 'id', id: 5, zone: 'DECK', player: 1 });
  });
});

describe('tags and values', () => {
  it('normalises tag names and numbers', () => {
    expect(tagId('ZONE')).toBe(GameTag.ZONE);
    expect(tagId('937')).toBe(937);
    expect(tagName(GameTag.PLAYER_LEADERBOARD_PLACE)).toBe('PLAYER_LEADERBOARD_PLACE');
    expect(tagName(1068)).toBe('1068');
    // unknown names get a stable synthetic id and keep their name
    const u = tagId('SOME_FUTURE_TAG');
    expect(u).toBeLessThan(0);
    expect(tagId('SOME_FUTURE_TAG')).toBe(u);
    expect(tagName(u)).toBe('SOME_FUTURE_TAG');
  });

  it('parses enum values', () => {
    expect(tagValue(GameTag.ZONE, 'PLAY')).toBe(Zone.PLAY);
    expect(tagValue(GameTag.ZONE, 'REMOVEDFROMGAME')).toBe(Zone.REMOVEDFROMGAME);
    expect(tagValue(GameTag.CARDTYPE, 'HERO')).toBe(CardType.HERO);
    expect(tagValue(GameTag.CARDTYPE, 'BATTLEGROUND_TRINKET')).toBe(CardType.BATTLEGROUND_TRINKET);
    expect(tagValue(GameTag.STEP, 'MAIN_READY')).toBe(Step.MAIN_READY);
    expect(tagValue(GameTag.NEXT_STEP, 'FINAL_GAMEOVER')).toBe(Step.FINAL_GAMEOVER);
    expect(tagValue(GameTag.CARDRACE, 'DEMON')).toBe(Race.DEMON);
    expect(tagValue(GameTag.CARDRACE, 'PET')).toBe(Race.BEAST);
    expect(tagValue(GameTag.PLAYSTATE, 'WON')).toBe(PlayState.WON);
    expect(tagValue(GameTag.MULLIGAN_STATE, 'DEALING')).toBe(Mulligan.DEALING);
    expect(tagValue(GameTag.FACTION, 'ALLIANCE')).toBe(2);
    expect(tagValue(GameTag.RARITY, 'LEGENDARY')).toBe(5);
    expect(tagValue(GameTag.ATK, '-3')).toBe(-3);
    expect(tagValue(GameTag.ATK, '12')).toBe(12);
  });
});

describe('PowerLogParser', () => {
  it('parses CREATE_GAME with GameEntity / Player blocks', () => {
    const pk = parsePowerLog([
      L('CREATE_GAME'),
      L('    GameEntity EntityID=13'),
      L('        tag=CARDTYPE value=GAME'),
      L('        tag=937 value=3459'),
      L('    Player EntityID=14 PlayerID=5 GameAccountId=[hi=144115198130930503 lo=38593682]'),
      L('        tag=PLAYER_ID value=5'),
      L('        tag=NEXT_OPPONENT_PLAYER_ID value=4'),
      L('FULL_ENTITY - Creating ID=33 CardID=TB_BaconShop_HERO_PH'),
      L('    tag=CARDTYPE value=HERO'),
      L('    tag=ZONE value=PLAY'),
      L('TAG_CHANGE Entity=13 tag=STATE value=RUNNING '),
    ]);
    expect(pk.map((p) => p.type)).toEqual(['CreateGame', 'GameEntity', 'Player', 'FullEntity', 'TagChange']);
    expect(pk[1]).toMatchObject({ id: 13, tags: [[GameTag.CARDTYPE, CardType.GAME], [937, 3459]] });
    expect(pk[2]).toMatchObject({ id: 14, playerId: 5, accountHi: '144115198130930503', accountLo: '38593682' });
    expect(pk[3]).toMatchObject({ id: 33, cardId: 'TB_BaconShop_HERO_PH', tags: [[GameTag.CARDTYPE, CardType.HERO], [GameTag.ZONE, Zone.PLAY]] });
    expect(pk[4]).toMatchObject({ type: 'TagChange', entity: { kind: 'id', id: 13 }, tag: GameTag.STATE, value: 2, ts: '13:18:11.0621247' });
  });

  it('parses TAG_CHANGE with player names, numeric tags and DEF CHANGE', () => {
    const t = one([L('    TAG_CHANGE Entity=Ragnaros, Tikilord tag=HERO_ENTITY value=453 ')], 'TagChange');
    expect(t).toMatchObject({ entity: { kind: 'name', name: 'Ragnaros, Tikilord' }, tag: GameTag.HERO_ENTITY, value: 453 });
    const n = one([L('TAG_CHANGE Entity=GameEntity tag=1882 value=2 ')], 'TagChange');
    expect(n).toMatchObject({ entity: { kind: 'game' }, tag: 1882, value: 2 });
    const d = one([L('    TAG_CHANGE Entity=262 tag=COST value=2 DEF CHANGE')], 'TagChange');
    expect(d).toMatchObject({ tag: GameTag.COST, value: 2, def: true });
    const b = one(
      [L('TAG_CHANGE Entity=[entityName=Icky Imp id=268 zone=PLAY zonePos=1 cardId=BG21_029 player=5] tag=ZONE value=PLAY ')],
      'TagChange',
    );
    expect(b).toMatchObject({ entity: { id: 268, cardId: 'BG21_029' }, tag: GameTag.ZONE, value: Zone.PLAY });
  });

  it('parses blocks (with the broken EffectCardId list) and sub-spells / meta data children', () => {
    const pk = parsePowerLog([
      L(
        'BLOCK_START BlockType=TRIGGER Entity=[entityName=BaconShop8PlayerEnchant id=59 zone=PLAY zonePos=0 cardId=TB_BaconShop_8P_PlayerE player=5] EffectCardId=System.Collections.Generic.List`1[System.String] EffectIndex=-1 Target=0 SubOption=-1 TriggerKeyword=TAG_NOT_SET',
      ),
      L('    SUB_SPELL_START - SpellPrefabGUID=Bacon_Sell_AE_CoinThrow_Super:88d6 Source=58 TargetCount=1'),
      L('                      Source = [entityName=Ragnaros, Tikilord id=58 zone=PLAY zonePos=0 cardId=TB_BaconShopBob_SKIN_A player=13]'),
      L('                      Targets[0] = 93'),
      L('    SUB_SPELL_END'),
      L('    META_DATA - Meta=DAMAGE Data=3 InfoCount=1'),
      L('                Info[0] = [entityName=Icky Imp id=268 zone=PLAY zonePos=1 cardId=BG21_029 player=5]'),
      L(
        '    BLOCK_START BlockType=ATTACK Entity=[entityName=Icky Imp id=455 zone=PLAY zonePos=1 cardId=BG21_029 player=5] EffectCardId=System.Collections.Generic.List`1[System.String] EffectIndex=0 Target=0 SubOption=-1 ',
      ),
      L('    BLOCK_END'),
      L('BLOCK_END'),
    ]);
    expect(pk.map((p) => p.type)).toEqual(['BlockStart', 'SubSpellStart', 'SubSpellEnd', 'MetaData', 'BlockStart', 'BlockEnd', 'BlockEnd']);
    expect(pk[0]).toMatchObject({ blockType: 5, entity: { id: 59 }, effectIndex: -1, subOption: -1, triggerKeyword: 'TAG_NOT_SET' });
    expect(pk[1]).toMatchObject({ prefab: 'Bacon_Sell_AE_CoinThrow_Super:88d6', source: { id: 58 }, targets: [{ id: 93 }] });
    expect(pk[3]).toMatchObject({ meta: 1, data: 3, info: [{ id: 268 }] });
    expect(pk[4]).toMatchObject({ blockType: 1, entity: { id: 455 } });
    expect((pk[4] as { target?: unknown }).target).toBeUndefined();
  });

  it('parses SHOW/HIDE/CHANGE_ENTITY', () => {
    const pk = parsePowerLog([
      L('SHOW_ENTITY - Updating Entity=266 CardID=TB_BaconShop_HP_038e'),
      L('    tag=ATTACHED value=14'),
      L('HIDE_ENTITY - Entity=[entityName=3ofKindCheckPlayerEnchant id=60 zone=PLAY zonePos=0 cardId=TB_BaconShop_3ofKindChecke player=5] tag=ZONE value=GRAVEYARD'),
      L('CHANGE_ENTITY - Updating Entity=[entityName=Deathwing id=82 zone=HAND zonePos=2 cardId=TB_BaconShop_HERO_52 player=4] CardID=TB_BaconShop_HERO_37'),
    ]);
    expect(pk[0]).toMatchObject({ type: 'ShowEntity', entity: { id: 266 }, cardId: 'TB_BaconShop_HP_038e', tags: [[GameTag.ATTACHED, 14]] });
    expect(pk[1]).toMatchObject({ type: 'HideEntity', entity: { id: 60 }, zone: Zone.GRAVEYARD });
    expect(pk[2]).toMatchObject({ type: 'ChangeEntity', entity: { id: 82 }, cardId: 'TB_BaconShop_HERO_37' });
  });

  it('parses DebugPrintGame, entity choices and chosen entities', () => {
    const pk = parsePowerLog([
      'D 13:17:54.2795495 GameState.DebugPrintGame() - BuildNumber=139963',
      'D 13:17:54.2795495 GameState.DebugPrintGame() - GameType=GT_BATTLEGROUNDS',
      'D 13:17:54.2795495 GameState.DebugPrintGame() - PlayerID=13, PlayerName=The Innkeeper',
      'D 13:17:54.5693701 GameState.DebugPrintEntityChoices() - id=1 Player=MuNGGG#2882 TaskList=6 ChoiceType=MULLIGAN CountMin=1 CountMax=1',
      'D 13:17:54.5693701 GameState.DebugPrintEntityChoices() -   Source=GameEntity',
      'D 13:17:54.5693701 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=Shudderwock id=92 zone=HAND zonePos=2 cardId=TB_BaconShop_HERO_23 player=5]',
      'D 13:17:54.5693701 GameState.DebugPrintEntityChoices() -   Entities[1]=[entityName=Captain Hooktusk id=91 zone=HAND zonePos=1 cardId=TB_BaconShop_HERO_67 player=5]',
      'D 13:17:56.0000000 GameState.DebugPrintOptions() - id=1',
      'D 13:18:10.7288528 GameState.SendChoices() - id=1 ChoiceType=MULLIGAN',
      'D 13:18:10.9801449 GameState.DebugPrintEntitiesChosen() - id=1 Player=MuNGGG#2882 EntitiesCount=1',
      'D 13:18:10.9801449 GameState.DebugPrintEntitiesChosen() -   Entities[0]=[entityName=Shudderwock id=92 zone=HAND zonePos=2 cardId=TB_BaconShop_HERO_23 player=5]',
    ]);
    expect(pk.map((p) => p.type)).toEqual(['GameInfo', 'GameInfo', 'GameInfo', 'EntityChoices', 'EntitiesChosen']);
    expect(pk[0]).toMatchObject({ key: 'BuildNumber', value: '139963' });
    expect(pk[2]).toMatchObject({ key: 'Player', playerId: 13, playerName: 'The Innkeeper' });
    expect(pk[3]).toMatchObject({ choiceId: 1, player: { kind: 'name', name: 'MuNGGG#2882' }, taskList: 6, choiceType: 1, countMax: 1, source: { kind: 'game' } });
    expect((pk[3] as Extract<Packet, { type: 'EntityChoices' }>).entities.map((e) => e.cardId)).toEqual(['TB_BaconShop_HERO_23', 'TB_BaconShop_HERO_67']);
    expect(pk[4]).toMatchObject({ choiceId: 1, entities: [{ id: 92 }] });
  });

  it('uses only the source that printed the first CREATE_GAME', () => {
    const lines = fixtureLines('bg_36393.power.log.gz'); // has both GameState and PowerTaskList lines
    const p = new PowerLogParser();
    const pk: Packet[] = [];
    for (const l of lines) p.feedLine(l, pk);
    p.flush(pk);
    expect(p.source).toBe('GameState');
    expect(pk.filter((x) => x.type === 'CreateGame')).toHaveLength(1);
    // a PowerTaskList-only stream is parsed too
    const ptl = parsePowerLog(lines.filter((l) => l.includes('PowerTaskList.DebugPrintPower()')));
    expect(ptl.filter((x) => x.type === 'CreateGame')).toHaveLength(1);
    expect(ptl.filter((x) => x.type === 'FullEntity').length).toBe(pk.filter((x) => x.type === 'FullEntity').length);
  });

  it('tolerates \\r\\n endings, garbage and empty lines', () => {
    const pk = parsePowerLog([L('CREATE_GAME') + '\r', '', 'garbage', 'D 1 x', L('    GameEntity EntityID=1') + '\r\n']);
    expect(pk.map((p) => p.type)).toEqual(['CreateGame', 'GameEntity']);
  });

  it('parses the 230k-line 139963 log quickly', () => {
    const lines = fixtureLines('bg_139963_perfect_game.power.log.gz');
    const t0 = performance.now();
    const pk = parsePowerLog(lines);
    const ms = performance.now() - t0;
    expect(pk.filter((p) => p.type === 'FullEntity').length).toBe(4788);
    expect(pk.filter((p) => p.type === 'TagChange').length).toBe(86503);
    expect(pk.filter((p) => p.type === 'EntityChoices').length).toBe(41);
    expect(ms).toBeLessThan(2000);
  });
});
