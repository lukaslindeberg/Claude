/**
 * Integration tests over real Battlegrounds logs (HearthSim hsreplay-test-data, CC0).
 * `bg_139963*` and `bg_36393*` are raw Power.logs; the others were converted from HSReplay
 * XML with scripts/hsreplay-xml-to-log.ts. Every fact asserted below was checked against
 * the log itself (placements = local hero PLAYER_LEADERBOARD_PLACE / PLAYSTATE, damages =
 * leaderboard health changes, tier ups = PLAYER_TECH_LEVEL changes, ...).
 */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, BgGameState, CombatRecord } from '@shared/types';
import { BgTracker } from '../../src/core/bg';
import { simulateBattle } from '../../src/core/sim';
import { PowerLogParser, type Packet } from '../../src/core/log/powerLogParser';
import { fixtureLines, ofType, rng, runFixture, type Run } from './helpers';

interface Spec {
  file: string;
  mode: 'solo' | 'duos';
  gameType: string;
  build?: number;
  localPlayerId: number;
  localName: string;
  /** Hero options as finally offered (after rerolls). */
  options: string[];
  /** Options of the first heroOptions event when it differs (rerolls). */
  firstOptions?: string[];
  chosen: string;
  /** Lobby: PLAYER_ID -> leaderboard hero card id. */
  heroes: Record<number, string>;
  placement: number;
  turns: number;
  /** "turn:opponent:w|l|t damage" for every combat, in order. */
  combats: string;
  deaths?: string;
  localTiers?: Array<[number, number]>;
  teammate?: number;
  extra?: (run: Run) => void;
}

const SPECS: Spec[] = [
  {
    file: 'bg_139963_perfect_game.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 139963,
    localPlayerId: 5,
    localName: 'MuNGGG#2882',
    options: ['TB_BaconShop_HERO_23', 'TB_BaconShop_HERO_67', 'TB_BaconShop_HERO_49_SKIN_A', 'BG22_HERO_003'],
    chosen: 'TB_BaconShop_HERO_49_SKIN_A',
    heroes: {
      1: 'BG20_HERO_301',
      2: 'BG22_HERO_305',
      3: 'TB_BaconShop_HERO_02',
      4: 'BG22_HERO_201',
      5: 'TB_BaconShop_HERO_49_SKIN_A',
      6: 'TB_BaconShop_HERO_75',
      7: 'TB_BaconShop_HERO_16',
      8: 'TB_BaconShop_HERO_76',
    },
    placement: 1,
    turns: 16,
    combats: '1:4:w2 2:8:w4 3:2:w3 4:3:w6 5:6:w6 6:2:t0 7:1:t0 8:6:w12 9:4:w12 10:1:t0 11:6:w11 12:4:w12 13:3:w17 14:1:t0 15:4:w17 16:1:w9',
    deaths: '8@8 7@9 2@11 6@11 4@12 3@15 1@16',
    localTiers: [
      [2, 3],
      [3, 5],
      [4, 6],
      [5, 8],
      [6, 9],
    ],
    extra: ({ state, events }) => {
      // "perfect game": the local hero never took damage
      const local = state.players.find((p) => p.isLocal)!;
      expect(local.health).toBe(40);
      expect(local.healthHistory.every((h) => h.value === 40)).toBe(true);
      expect(state.chosenHeroCardId).toBe('TB_BaconShop_HERO_49_SKIN_A');
      const base = state.heroOptions.find((o) => o.cardId === 'TB_BaconShop_HERO_49_SKIN_A')!;
      expect(base.baseCardId).toBe('TB_BaconShop_HERO_49');
      expect(base.heroPowerCardId).toBe('TB_BaconShop_HP_054');
      expect(state.heroOptions.find((o) => o.cardId === 'BG22_HERO_003')!.armor).toBe(10);
      // the dummy player is printed under the opponent's name during combat
      expect(state.players.find((p) => p.playerId === 4)!.name).toBe('LadyGagaFTW');
      expect(state.players.find((p) => p.playerId === 8)!.name).toBe('Gvr');
      // damage cap printed on the GameEntity
      expect(ofType(events, 'combatStart')[0].input.damageCap).toBe(15);
      // a card unknown to the current card db keeps its log name and CARDRACE tribe
      const t2 = ofType(events, 'combatStart')[1].input;
      const bubblette = [...t2.player.minions, ...t2.opponent.minions].find((m) => m.cardId === 'BG_TID_713')!;
      expect(bubblette.name).toBe('Bubblette');
      expect(bubblette.tribes).toEqual(['ELEMENTAL']);
      expect(state.availableTribes).toEqual(['DEMON', 'ELEMENTAL', 'MURLOC', 'NAGA', 'PIRATE']);
      expect(state.tribesSource).toBe('inferred');
      // turn 15: the opponent (p4) was dead -> we fought its Kel'Thuzad ghost
      expect(ofType(events, 'combatStart')[14].input.opponent.heroCardId).toBe('TB_BaconShop_HERO_KelThuzad');
    },
  },
  {
    file: 'bg_36393.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 36393,
    localPlayerId: 3,
    localName: 'BehEh#1355',
    options: ['TB_BaconShop_HERO_11', 'TB_BaconShop_HERO_38'],
    chosen: 'TB_BaconShop_HERO_38',
    heroes: {
      1: 'TB_BaconShop_HERO_25',
      2: 'TB_BaconShop_HERO_34',
      3: 'TB_BaconShop_HERO_38',
      4: 'TB_BaconShop_HERO_28',
      5: 'TB_BaconShop_HERO_15',
      6: 'TB_BaconShop_HERO_30',
      7: 'TB_BaconShop_HERO_31',
      8: 'TB_BaconShop_HERO_22',
    },
    placement: 4,
    turns: 12,
    combats: '1:2:l2 2:4:t0 3:8:t0 4:4:w7 5:8:w4 6:4:l5 7:8:l7 8:4:l15 9:7:t0 10:4:l7 11:7:w13 12:4:l16',
    deaths: '1@10 6@10 7@11 2@12 3@12',
    localTiers: [
      [2, 2],
      [3, 5],
      [4, 7],
      [5, 11],
    ],
    extra: ({ state }) => {
      const local = state.players.find((p) => p.isLocal)!;
      // 40 health, lost 2+5+7+15+7+16 = 52
      expect(local.health).toBe(40 - 52);
      expect(local.dead).toBe(true);
    },
  },
  {
    file: 'bg_duos_trinkets_206605.power.log.gz',
    mode: 'duos',
    gameType: 'GT_BATTLEGROUNDS_DUO',
    build: 206605,
    localPlayerId: 2,
    localName: 'BehEh#1355',
    teammate: 3,
    options: ['TB_BaconShop_HERO_36', 'BGDUO_HERO_222', 'BG20_HERO_242', 'TB_BaconShop_HERO_15'],
    chosen: 'TB_BaconShop_HERO_15',
    heroes: {
      1: 'TB_BaconShop_HERO_11',
      2: 'TB_BaconShop_HERO_15',
      3: 'TB_BaconShop_HERO_45',
      4: 'BG26_HERO_104',
      5: 'TB_BaconShop_HERO_94',
      6: 'TB_BaconShop_HERO_64',
      7: 'BG30_HERO_304',
      8: 'BG20_HERO_202',
    },
    placement: 4,
    turns: 9,
    combats: '1:6:w2 2:1:l3 3:7:t0 4:6:l8 5:4:l7 6:7:l12 7:6:l7 8:4:l7 9:8:l15',
    deaths: '2@9 3@9',
    extra: ({ state, events }) => {
      expect(state.trinketsActive).toBe(true);
      const local = state.players.find((p) => p.isLocal)!;
      expect(local.trinkets).toEqual(['BG30_MagicItem_426', 'BG30_MagicItem_422t']);
      // teams (BACON_DUO_TEAM_ID): pairs share a team id, our team has the teammate
      const team = (pid: number) => state.players.find((p) => p.playerId === pid)!.teamId;
      expect(team(2)).toBe(team(3));
      expect(team(1)).toBe(team(4));
      expect(team(5)).toBe(team(6));
      expect(team(7)).toBe(team(8));
      expect(new Set([team(2), team(1), team(5), team(7)]).size).toBe(4);
      // every duos combat input has both teammates' boards
      for (const e of ofType(events, 'combatStart')) {
        expect(e.input.mode).toBe('duos');
        expect(e.input.player.teammate).toBeDefined();
        expect(e.input.opponent.teammate).toBeDefined();
        expect(new Set([e.input.player.playerId, e.input.player.teammate!.playerId])).toEqual(new Set([2, 3]));
      }
      // turns 3, 5 and 8: our teammate fought first (BACON_DUO_PLAYER_FIGHTS_FIRST_NEXT_COMBAT=0)
      expect(ofType(events, 'combatStart').map((e) => e.input.player.playerId)).toEqual([2, 2, 3, 2, 3, 2, 2, 3, 2]);
    },
  },
  {
    file: 'bg_duos_aberrations_deity_2026.power.log.gz',
    mode: 'duos',
    gameType: 'GT_BATTLEGROUNDS_DUO',
    localPlayerId: 4,
    localName: 'Player4#9058',
    teammate: 5,
    firstOptions: ['TB_BaconShop_HERO_76', 'BG22_HERO_201_SKIN_E', 'BG22_HERO_002_SKIN_E', 'TB_BaconShop_HERO_29_SKIN_F'],
    options: ['TB_BaconShop_HERO_76', 'BG22_HERO_201_SKIN_E', 'BG31_HERO_006', 'TB_BaconShop_HERO_29_SKIN_F'],
    chosen: 'BG22_HERO_201_SKIN_E',
    heroes: {
      1: 'BG21_HERO_010',
      2: 'TB_BaconShop_HERO_90_SKIN_G',
      3: 'BG35_HERO_001',
      4: 'BG22_HERO_201_SKIN_E',
      5: 'BG36_HERO_000',
      6: 'BG26_HERO_104',
      7: 'TB_BaconShop_HERO_38_SKIN_C',
      8: 'TB_BaconShop_HERO_41',
    },
    placement: 3,
    turns: 11,
    combats: '1:3:l3 2:1:l4 3:6:l4 4:8:w10 5:2:w11 6:7:w9 7:3:l11 8:1:l15 9:6:l9 10:8:w15 11:1:l15',
    localTiers: [
      [2, 2],
      [3, 4],
      [4, 5],
      [5, 7],
      [6, 8],
    ],
    extra: ({ state, events }) => {
      expect(state.availableTribes).toContain('ABERRATION');
      expect(state.availableTribes).toHaveLength(5);
      expect(state.trinketsActive).toBe(true);
      expect(state.players.find((p) => p.playerId === 5)!.isTeammate).toBe(true);
      // the whole Player entity tag set (+ lobby-wide GameEntity tags) reaches the simulator
      const last = ofType(events, 'combatStart').at(-1)!.input;
      const ours = last.player.playerId === 4 ? last.player : last.player.teammate!;
      expect(ours.playerTags.BACON_GLOBAL_OLD_GOD_DBID).toBe(132532);
      expect(ours.playerTags.BACON_OLD_GOD_ATTACK).toBeGreaterThan(0);
      expect(ours.playerTags.PLAYER_ID).toBe(4);
      expect(last.opponent.playerTags.BACON_GLOBAL_OLD_GOD_DBID).toBe(132532);
    },
  },
  {
    file: 'bg_quests_150659.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 150659,
    localPlayerId: 5,
    localName: 'Laserhog#1417',
    options: ['BG20_HERO_283', 'TB_BaconShop_HERO_49'],
    chosen: 'TB_BaconShop_HERO_49',
    heroes: {
      1: 'BG20_HERO_202',
      2: 'TB_BaconShop_HERO_62',
      3: 'TB_BaconShop_HERO_94',
      4: 'TB_BaconShop_HERO_02',
      5: 'TB_BaconShop_HERO_49',
      6: 'TB_BaconShop_HERO_18',
      7: 'TB_BaconShop_HERO_57',
      8: 'TB_BaconShop_HERO_60',
    },
    placement: 4,
    turns: 11,
    combats: '1:6:w3 2:2:w3 3:8:w4 4:4:w2 5:1:w3 6:8:l7 7:4:w5 8:3:w15 9:6:l18 10:8:l14 11:4:l23',
    extra: ({ state }) => {
      expect(state.questsActive).toBe(true);
      expect(state.players.find((p) => p.isLocal)!.questRewards).toEqual(['BG24_Reward_130']);
      // opponents' quest rewards seen with their boards
      expect(state.players.find((p) => p.playerId === 8)!.questRewards).toEqual(['BG24_Reward_111']);
    },
  },
  {
    file: 'bg_hero_reroll_213490.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 213490,
    localPlayerId: 4,
    localName: 'staticshock#1500',
    firstOptions: ['BG22_HERO_003_SKIN_C', 'TB_BaconShop_HERO_52', 'TB_BaconShop_HERO_93_SKIN_B', 'BG26_HERO_104'],
    options: ['BG22_HERO_003_SKIN_C', 'TB_BaconShop_HERO_37', 'TB_BaconShop_HERO_93_SKIN_B', 'BG26_HERO_104'],
    chosen: 'BG26_HERO_104',
    heroes: {
      1: 'BG24_HERO_204',
      2: 'TB_BaconShop_HERO_02',
      3: 'BG28_HERO_400',
      4: 'BG26_HERO_104',
      5: 'BG31_HERO_005',
      6: 'TB_BaconShop_HERO_23',
      7: 'BG28_HERO_801',
      8: 'BG20_HERO_280',
    },
    placement: 4,
    turns: 12,
    combats: '1:1:t0 2:2:l3 3:8:w3 4:5:w6 5:3:t0 6:8:w6 7:5:w10 8:1:w8 9:7:l15 10:3:w9 11:8:l15 12:1:l19',
    localTiers: [
      [2, 2],
      [3, 4],
      [4, 7],
      [5, 7],
      [6, 10],
    ],
    extra: ({ events, state }) => {
      // BACON_COMBAT_DAMAGE_CAP 5 -> 10 (turn 4) -> 15 (turn 8), disabled before turn 12
      expect(ofType(events, 'combatStart').map((e) => e.input.damageCap ?? 0)).toEqual([5, 5, 5, 10, 10, 10, 10, 15, 15, 15, 15, 0]);
      expect(state.heroOptions.find((o) => o.cardId === 'BG22_HERO_003_SKIN_C')!.baseCardId).toBe('BG22_HERO_003');
      expect(state.availableTribes).toEqual(['DEMON', 'DRAGON', 'ELEMENTAL', 'PIRATE', 'UNDEAD']);
    },
  },
  {
    file: 'bg_kelthuzad_37060.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 37060,
    localPlayerId: 7,
    localName: 'Rafaleo#21458',
    options: ['TB_BaconShop_HERO_42', 'TB_BaconShop_HERO_01'],
    chosen: 'TB_BaconShop_HERO_42',
    heroes: {
      1: 'TB_BaconShop_HERO_35',
      2: 'TB_BaconShop_HERO_43',
      3: 'BG23_HERO_306',
      4: 'TB_BaconShop_HERO_12',
      5: 'TB_BaconShop_HERO_14',
      6: 'TB_BaconShop_HERO_28',
      7: 'TB_BaconShop_HERO_42',
      8: 'TB_BaconShop_HERO_34',
    },
    placement: 6,
    turns: 5,
    combats: '1:6:l2 2:2:l3 3:8:w6 4:1:l6',
    deaths: '8@2 5@3 7@5',
    extra: ({ events }) => {
      // p8 died on turn 2: on turn 3 we fought its Kel'Thuzad ghost (damage healed back, recorded 6)
      expect(ofType(events, 'combatStart')[2].input.opponent.heroCardId).toBe('TB_BaconShop_HERO_KelThuzad');
    },
  },
  {
    file: 'bg_kelthuzad_full_38377.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 38377,
    localPlayerId: 7,
    localName: '皮皮珍美美哒#5256',
    options: ['TB_BaconShop_HERO_11', 'TB_BaconShop_HERO_31', 'TB_BaconShop_HERO_45'],
    chosen: 'TB_BaconShop_HERO_45',
    heroes: {
      1: 'TB_BaconShop_HERO_16',
      2: 'TB_BaconShop_HERO_25',
      3: 'TB_BaconShop_HERO_36',
      4: 'TB_BaconShop_HERO_42',
      5: 'TB_BaconShop_HERO_30',
      6: 'TB_BaconShop_HERO_17',
      7: 'TB_BaconShop_HERO_45',
      8: 'TB_BaconShop_HERO_27',
    },
    // the local hero's final PLAYER_LEADERBOARD_PLACE (2) is printed AFTER PLAYSTATE=LOST
    placement: 2,
    turns: 16,
    combats: '1:3:t0 2:1:w4 3:3:w5 4:1:t0 5:8:w5 6:1:l5 7:8:w10 8:5:l6 9:6:w12 10:4:w20 11:1:w7 12:2:w16 13:1:l11 14:5:l14 15:1:w8 16:1:l12',
    deaths: '8@7 3@10 6@10 4@11 2@12 5@14 7@16',
  },
  {
    file: 'bg_reconnect.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    localPlayerId: 4,
    localName: 'Roni#1458',
    options: [],
    chosen: 'TB_BaconShop_HERO_56',
    heroes: {
      1: 'TB_BaconShop_HERO_17',
      2: 'TB_BaconShop_HERO_02',
      3: 'TB_BaconShop_HERO_33',
      4: 'TB_BaconShop_HERO_56',
      5: 'TB_BaconShop_HERO_14',
      6: 'TB_BaconShop_HERO_22',
      7: 'TB_BaconShop_HERO_42',
      8: 'TB_BaconShop_HERO_16',
    },
    placement: 6,
    turns: 12,
    // the log starts after a reconnect, mid-game (turn 7)
    combats: '7:1:l13 8:8:w28 9:3:l11 10:1:w10 11:8:w30 12:7:l19',
  },
  {
    file: 'bg_async_gameover.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    localPlayerId: 6,
    localName: 'Meshell#21877',
    options: ['TB_BaconShop_HERO_12', 'TB_BaconShop_HERO_72', 'TB_BaconShop_HERO_94', 'TB_BaconShop_HERO_53'],
    chosen: 'TB_BaconShop_HERO_94',
    heroes: {
      1: 'TB_BaconShop_HERO_92',
      2: 'TB_BaconShop_HERO_11',
      3: 'TB_BaconShop_HERO_74',
      4: 'TB_BaconShop_HERO_22',
      5: 'TB_BaconShop_HERO_62',
      6: 'TB_BaconShop_HERO_94',
      7: 'TB_BaconShop_HERO_15',
      8: 'TB_BaconShop_HERO_41',
    },
    placement: 1,
    turns: 17,
    // after PLAYSTATE=WON the server keeps running a ghost combat: it must not be recorded
    combats: '1:4:t0 2:2:t0 3:7:l3 4:1:w7 5:2:w8 6:7:w6 7:3:w11 8:1:t0 9:2:w11 10:4:w8 11:8:l18 12:7:t0 13:1:w30 14:4:w16 15:8:w16 16:7:w10 17:7:w16',
  },
  {
    file: 'bg_conceded_turn3_37060.power.log.gz',
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    build: 37060,
    localPlayerId: 7,
    localName: 'Almur45#21408',
    options: ['TB_BaconShop_HERO_36', 'TB_BaconShop_HERO_15'],
    chosen: 'TB_BaconShop_HERO_36',
    heroes: {
      1: 'TB_BaconShop_HERO_25',
      2: 'TB_BaconShop_HERO_17',
      3: 'TB_BaconShop_HERO_45',
      4: 'TB_BaconShop_HERO_16',
      5: 'TB_BaconShop_HERO_01',
      6: 'TB_BaconShop_HERO_30',
      7: 'TB_BaconShop_HERO_36',
      8: 'TB_BaconShop_HERO_37',
    },
    placement: 8,
    turns: 3,
    combats: '1:8:l2 2:2:w3',
    deaths: '7@3',
  },
];

const fmt = (r: CombatRecord) => `${r.turn}:${r.opponentPlayerId}:${r.result[0]}${r.damage}`;
const hp = (s: BgGameState, pid: number) => {
  const p = s.players.find((x) => x.playerId === pid);
  return p ? p.health + p.armor : NaN;
};

/** Combat against a dead player's ghost (Kel'Thuzad): its leaderboard health cannot drop. */
function isGhost(c: CombatObs): boolean {
  return c.input.opponent.heroCardId.includes('KelThuzad') || !!c.start.players.find((p) => p.playerId === c.record?.opponentPlayerId)?.dead;
}

interface CombatObs {
  input: BattleSimInput;
  start: BgGameState;
  record?: CombatRecord;
  after?: BgGameState;
  /** Entities that attacked during the combat and existed when the input was captured. */
  attackers: number[];
  maxIdAtCapture: number;
}

/** Runs a fixture recording per-combat observations (state at start / after, attackers). */
function observe(file: string): { run: Run; combats: CombatObs[] } {
  const combats: CombatObs[] = [];
  let open: CombatObs | undefined;
  let awaitingAfter: CombatObs | undefined;
  const parser = new PowerLogParser();
  let maxId = 0;
  const tracker = new BgTracker({ now: () => 1_700_000_000_000 });
  const events = [];
  const pk: Packet[] = [];
  const t0 = performance.now();
  const lines = fixtureLines(file);
  for (const line of lines) {
    pk.length = 0;
    parser.feedLine(line, pk);
    for (const p of pk) {
      if (p.type === 'FullEntity' && p.id > maxId) maxId = p.id;
      if (open && !open.record && p.type === 'BlockStart' && p.blockType === 1 && p.entity.kind === 'id' && p.entity.id! <= open.maxIdAtCapture) {
        open.attackers.push(p.entity.id!);
      }
    }
    for (const e of tracker.feedLine(line)) {
      events.push(e);
      if (e.type === 'combatStart') {
        open = { input: e.input, start: tracker.getState(), attackers: [], maxIdAtCapture: maxId };
        combats.push(open);
      } else if (e.type === 'combatEnd') {
        if (open) {
          open.record = e.record;
          awaitingAfter = open;
        }
        open = undefined;
      } else if ((e.type === 'turnStart' || e.type === 'gameEnd') && awaitingAfter) {
        awaitingAfter.after = tracker.getState();
        awaitingAfter = undefined;
      }
    }
  }
  events.push(...tracker.flush());
  const ms = performance.now() - t0;
  return { run: { tracker, events, state: tracker.getState(), ms }, combats };
}

describe.each(SPECS)('fixture $file', (spec) => {
  const { run, combats } = observe(spec.file);
  const { state, events } = run;
  const local = state.players.find((p) => p.isLocal);

  it('detects the BG game, mode and local player', () => {
    expect(state.active).toBe(true);
    expect(state.mode).toBe(spec.mode);
    expect(state.gameType).toBe(spec.gameType);
    if (spec.build) expect(state.buildNumber).toBe(spec.build);
    expect(state.localPlayerId).toBe(spec.localPlayerId);
    expect(state.localPlayerName).toBe(spec.localName);
    expect(ofType(events, 'gameStart')).toHaveLength(1);
    expect(ofType(events, 'gameStart')[0].mode).toBe(spec.mode);
    expect(local?.playerId).toBe(spec.localPlayerId);
    expect(state.players.filter((p) => p.isLocal)).toHaveLength(1);
  });

  it('hero options and chosen hero', () => {
    expect(state.heroOptions.map((o) => o.cardId)).toEqual(spec.options);
    const optEvents = ofType(events, 'heroOptions');
    if (spec.options.length) {
      expect(optEvents[0].options.map((o) => o.cardId)).toEqual(spec.firstOptions ?? spec.options);
      expect(optEvents[optEvents.length - 1].options.map((o) => o.cardId)).toEqual(spec.options);
      expect(optEvents).toHaveLength(spec.firstOptions ? 2 : 1);
      for (const o of state.heroOptions) expect(o.baseCardId).toBeTruthy();
    } else expect(optEvents).toHaveLength(0);
    expect(state.chosenHeroCardId).toBe(spec.chosen);
    expect(ofType(events, 'heroChosen')).toEqual([{ type: 'heroChosen', cardId: spec.chosen }]);
    expect(local?.heroCardId).toBe(spec.chosen);
  });

  it('lobby: 8 players with the right heroes', () => {
    const heroes = Object.fromEntries(state.players.map((p) => [p.playerId, p.heroCardId]));
    expect(heroes).toEqual(Object.fromEntries(Object.entries(spec.heroes).map(([k, v]) => [Number(k), v])));
    expect(new Set(state.players.map((p) => p.heroEntityId)).size).toBe(8);
    const places = state.players.map((p) => p.leaderboardPlace).sort((a, b) => a - b);
    expect(places[0]).toBe(1);
    if (spec.teammate) {
      expect(state.players.filter((p) => p.isTeammate).map((p) => p.playerId)).toEqual([spec.teammate]);
      for (const p of state.players) expect(p.teamId).toBeGreaterThan(0);
    }
  });

  it('final placement, turns and gameEnd record', () => {
    expect(state.phase).toBe('gameOver');
    expect(state.finalPlacement).toBe(spec.placement);
    expect(state.turn).toBe(spec.turns);
    const ends = ofType(events, 'gameEnd');
    expect(ends).toHaveLength(1);
    const rec = ends[0].record;
    expect(rec.placement).toBe(spec.placement);
    expect(rec.heroCardId).toBe(spec.chosen);
    expect(rec.mode).toBe(spec.mode);
    expect(rec.turns).toBe(spec.turns);
    expect(rec.combats.map(fmt).join(' ')).toBe(spec.combats);
    expect(rec.heroOptions).toEqual(spec.options);
    expect(rec.lobby).toHaveLength(8);
    expect(rec.finalTier).toBe(local!.tavernTier);
    expect(rec.finalBoard.length).toBeGreaterThan(0);
    expect(rec.finalBoard.length).toBeLessThanOrEqual(7);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
  });

  it('combats: records, opponents and damages consistent with leaderboard health', () => {
    const records = ofType(events, 'combatEnd').map((e) => e.record);
    expect(records.map(fmt).join(' ')).toBe(spec.combats);
    expect(ofType(events, 'combatStart')).toHaveLength(records.length);
    expect(state.battles).toHaveLength(records.length);
    for (const [i, b] of state.battles.entries()) {
      expect(b.status).toBe('waiting');
      expect(b.actual).toEqual({ result: records[i].result, damage: records[i].damage });
    }
    // per-opponent history
    for (const p of state.players) {
      expect(p.combatsAgainst.map(fmt)).toEqual(records.filter((r) => r.opponentPlayerId === p.playerId).map(fmt));
    }
    let checkedWins = 0;
    for (const c of combats) {
      const r = c.record!;
      expect(r).toBeDefined();
      // the opponent is the NEXT_OPPONENT_PLAYER_ID announced before the combat
      expect(r.opponentPlayerId).toBe(c.start.nextOpponentPlayerId);
      expect(c.start.currentOpponentPlayerId).toBe(c.input.opponent.playerId);
      const ghost = isGhost(c);
      if (spec.mode === 'solo') {
        expect(c.input.opponent.playerId).toBe(r.opponentPlayerId);
        if (!ghost) expect(c.input.opponent.heroCardId).toBe(spec.heroes[r.opponentPlayerId]);
      } else {
        // duos: the first fighter of the other team is the opponent or its teammate
        const oppTeam = c.start.players.find((p) => p.playerId === r.opponentPlayerId)!.teamId;
        expect(c.start.players.find((p) => p.playerId === c.input.opponent.playerId)!.teamId).toBe(oppTeam);
      }
      if (!c.after) continue;
      const localDrop = hp(c.start, spec.localPlayerId) - hp(c.after, spec.localPlayerId);
      if (r.result === 'lost') expect(localDrop).toBe(r.damage);
      else expect(localDrop).toBe(0);
      if (r.result === 'tied') expect(r.damage).toBe(0);
      if (r.result === 'won') {
        expect(r.damage).toBeGreaterThan(0);
        if (!ghost) {
          expect(hp(c.start, r.opponentPlayerId) - hp(c.after, r.opponentPlayerId)).toBe(r.damage);
          checkedWins++;
        }
      }
    }
    if (combats.some((c) => c.record?.result === 'won' && !isGhost(c) && c.after)) expect(checkedWins).toBeGreaterThan(0);
  });

  it('battle sim inputs: well-formed and consistent with the actual combat', () => {
    let midGame = 0;
    let nonEmpty = 0;
    for (const c of combats) {
      const { input } = c;
      expect(input.mode).toBe(spec.mode);
      expect(input.turn).toBe(c.record!.turn);
      const sides = [input.player, input.opponent, input.player.teammate, input.opponent.teammate].filter((x) => !!x);
      for (const side of sides) {
        expect(side!.minions.length).toBeLessThanOrEqual(7);
        expect(side!.heroCardId).toBeTruthy();
        expect(side!.tavernTier).toBeGreaterThanOrEqual(1);
        side!.minions.forEach((m) => {
          expect(m.cardId).toBeTruthy();
          expect(m.tags.CARDTYPE).toBe(4);
          expect(m.maxHealth).toBeGreaterThanOrEqual(m.health);
          for (const en of m.enchantments) expect(en.cardId).toBeTruthy();
        });
      }
      // live sides are in board order
      for (const side of [input.player, input.opponent]) {
        const pos = side.minions.map((m) => m.position);
        expect(pos).toEqual([...pos].sort((a, b) => a - b));
      }
      expect(Object.keys(input.player.heroTags).length).toBeGreaterThan(0);
      expect(Object.keys(input.player.playerTags).length).toBeGreaterThan(0);
      if (input.turn >= 5 && !isGhost(c)) {
        midGame++;
        if (input.player.minions.length && input.opponent.minions.length) nonEmpty++;
      }
      // Every minion that attacked and already existed at capture time must be in the input
      // (input captured after the boards were set up, before anything resolved).
      const known = new Set<number>();
      for (const side of sides) {
        known.add(side!.heroTags.ENTITY_ID);
        for (const m of side!.minions) known.add(m.entityId);
      }
      const unknown = c.attackers.filter((id) => !known.has(id));
      expect(unknown).toEqual([]);
    }
    if (midGame) expect(nonEmpty / midGame).toBeGreaterThanOrEqual(0.8);
  });

  it('every combatStart input runs through the simulator', () => {
    for (const c of combats) {
      const r = simulateBattle(c.input, { iterations: 30, maxDurationMs: 500, seed: 1 });
      expect(r.win + r.tie + r.loss).toBeCloseTo(100, 0);
    }
  });

  it('opponent boards, histories and deaths', () => {
    for (const p of state.players) {
      // tier history: strictly increasing tiers at non-decreasing turns, ends at current tier
      for (let i = 1; i < p.tierHistory.length; i++) {
        expect(p.tierHistory[i].tier).toBeGreaterThan(p.tierHistory[i - 1].tier);
        expect(p.tierHistory[i].turn).toBeGreaterThanOrEqual(p.tierHistory[i - 1].turn);
      }
      if (p.tierHistory.length) expect(p.tierHistory[p.tierHistory.length - 1].tier).toBe(p.tavernTier);
      for (let i = 1; i < p.healthHistory.length; i++) expect(p.healthHistory[i].turn).toBeGreaterThan(p.healthHistory[i - 1].turn);
      if (!p.isLocal && p.combatsAgainst.length && !spec.teammate) {
        expect(p.lastBoard).toBeDefined();
        expect(p.lastBoard!.turn).toBe(p.combatsAgainst[p.combatsAgainst.length - 1].turn);
      }
      if (p.dead) expect(p.health).toBeLessThanOrEqual(0);
    }
    if (spec.localTiers) expect(local!.tierHistory.map((t) => [t.tier, t.turn])).toEqual(spec.localTiers);
    if (spec.deaths) expect(ofType(events, 'playerDied').map((e) => `${e.playerId}@${e.turn}`).join(' ')).toBe(spec.deaths);
    for (const d of ofType(events, 'playerDied')) {
      const p = state.players.find((x) => x.playerId === d.playerId)!;
      expect(p.dead).toBe(true);
      expect(p.diedOnTurn).toBe(d.turn);
    }
    expect(local!.healthHistory.length).toBeGreaterThan(0);
  });

  if (spec.extra) it('fixture specific facts', () => spec.extra!(run));
});

describe('tracker robustness', () => {
  it('chunked feeding (random chunk sizes, getState in between) gives an identical result', () => {
    for (const file of ['bg_139963_perfect_game.power.log.gz', 'bg_duos_trinkets_206605.power.log.gz']) {
      const ref = runFixture(file);
      const lines = fixtureLines(file);
      const rand = rng(1234);
      const t = new BgTracker({ now: () => 1_700_000_000_000 });
      const events = [];
      for (let i = 0; i < lines.length; ) {
        const n = 1 + Math.floor(rand() * 5000);
        events.push(...t.feedLines(lines.slice(i, i + n)));
        t.getState();
        i += n;
      }
      events.push(...t.flush());
      expect(JSON.stringify(events)).toBe(JSON.stringify(ref.events));
      expect(JSON.stringify(t.getState())).toBe(JSON.stringify(ref.state));
    }
  });

  it('parses and tracks the 230k-line 139963 log well under 3 s', () => {
    const lines = fixtureLines('bg_139963_perfect_game.power.log.gz');
    expect(lines.length).toBeGreaterThan(230_000);
    const t0 = performance.now();
    const t = new BgTracker();
    t.feedLines(lines);
    t.getState();
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('zero-turn game (conceded during hero selection) does not crash', () => {
    const { state, events } = runFixture('bg_zero_turn_37060.power.log.gz');
    expect(state.active).toBe(true);
    expect(state.turn).toBe(0);
    expect(state.finalPlacement).toBe(8);
    expect(state.heroOptions.map((o) => o.cardId)).toEqual(['TB_BaconShop_HERO_12', 'BG23_HERO_306']);
    expect(ofType(events, 'combatStart')).toHaveLength(0);
    expect(ofType(events, 'gameEnd')[0].record.placement).toBe(8);
  });

  it('mid-game state: recruit phase has shop offers, board, gold; combat phase has the battle', () => {
    const lines = fixtureLines('bg_139963_perfect_game.power.log.gz');
    const t = new BgTracker();
    let recruit: BgGameState | undefined;
    let combat: BgGameState | undefined;
    for (const l of lines) {
      for (const e of t.feedLine(l)) {
        if (e.type === 'combatStart' && e.turn === 6) combat = t.getState();
      }
      // somewhere in the middle of turn 6's shop phase
      if (!recruit && t.getState().turn === 6 && t.getState().phase === 'recruit' && t.getState().shop.length >= 3) recruit = t.getState();
      if (combat) break;
    }
    expect(recruit).toBeDefined();
    expect(recruit!.shop.every((o) => o.cardId && o.name)).toBe(true);
    expect(recruit!.localBoard.length).toBeGreaterThan(0);
    expect(recruit!.gold).toBeGreaterThanOrEqual(0);
    expect(recruit!.maxGold).toBeGreaterThan(0);
    expect(recruit!.players.find((p) => p.isNextOpponent)?.playerId).toBe(2);
    expect(combat!.phase).toBe('combat');
    expect(combat!.battle.status).toBe('waiting');
    expect(combat!.battle.input?.opponent.playerId).toBe(2);
    expect(combat!.currentOpponentPlayerId).toBe(2);
    expect(combat!.shop).toEqual([]);
    expect(combat!.localBoard.length).toBe(combat!.battle.input!.player.minions.length);
  });
});
