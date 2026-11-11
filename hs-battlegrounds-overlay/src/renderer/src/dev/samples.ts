/**
 * Hand-written, realistic sample data for the browser demo and screenshots.
 * All card ids are real patch 37.0.2 Battlegrounds cards from the bundled card data.
 */
import { CardDb } from '@core/cards/cardDb';
import type {
  AppStatus,
  BattleSimInput,
  BattleState,
  BgGameState,
  BoardSnapshot,
  CombatRecord,
  HeroStat,
  HeroStatsBundle,
  MatchRecord,
  MinionKeywords,
  MinionSnapshot,
  PlayerState,
  ShopOffer,
  SimSide,
  Tribe,
  TrinketOption,
  TrinketStatsBundle,
} from '@shared/types';
import { COMMUNITY_HEROES, COMMUNITY_TRINKETS } from './sampleCommunity';

const db = CardDb.bundled();
let nextEntity = 100;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const MECH_TO_KW: Record<string, keyof MinionKeywords> = {
  TAUNT: 'taunt',
  DIVINE_SHIELD: 'divineShield',
  POISONOUS: 'poisonous',
  VENOMOUS: 'venomous',
  WINDFURY: 'windfury',
  MEGA_WINDFURY: 'megaWindfury',
  REBORN: 'reborn',
  STEALTH: 'stealth',
  CLEAVE: 'cleave',
  DEATHRATTLE: 'deathrattle',
  START_OF_COMBAT: 'startOfCombat',
  AVENGE: 'avenge',
  MAGNETIC: 'magnetic',
};

const KW_TO_TAG: Record<keyof MinionKeywords, string> = {
  taunt: 'TAUNT',
  divineShield: 'DIVINE_SHIELD',
  poisonous: 'POISONOUS',
  venomous: 'VENOMOUS',
  windfury: 'WINDFURY',
  megaWindfury: 'MEGA_WINDFURY',
  reborn: 'REBORN',
  stealth: 'STEALTH',
  cleave: 'CLEAVE',
  deathrattle: 'DEATHRATTLE',
  startOfCombat: 'START_OF_COMBAT',
  avenge: 'AVENGE',
  magnetic: 'MAGNETIC',
};

type M = [cardId: string, attack?: number, health?: number, extra?: { golden?: boolean; damage?: number; kw?: MinionKeywords }];

export function minion(spec: M, position: number): MinionSnapshot {
  const [cardId, atk, hp, extra = {}] = spec;
  const base = db.get(cardId);
  if (!base) throw new Error(`Unknown sample card ${cardId}`);
  const golden = !!extra.golden;
  const id = golden && base.goldenId ? base.goldenId : cardId;
  const keywords: MinionKeywords = {};
  for (const m of base.mechanics) {
    const k = MECH_TO_KW[m];
    if (k) keywords[k] = true;
  }
  Object.assign(keywords, extra.kw ?? {});
  const attack = atk ?? (base.attack ?? 0) * (golden ? 2 : 1);
  const maxHealth = hp ?? (base.health ?? 1) * (golden ? 2 : 1);
  const damage = extra.damage ?? 0;
  const tags: Record<string, number> = {
    ATK: attack,
    HEALTH: maxHealth,
    DAMAGE: damage,
    ZONE_POSITION: position,
    TECH_LEVEL: base.tier ?? 1,
    PREMIUM: golden ? 1 : 0,
  };
  for (const [k, v] of Object.entries(keywords)) if (v) tags[KW_TO_TAG[k as keyof MinionKeywords]] = 1;
  return {
    entityId: nextEntity++,
    cardId: id,
    name: base.name,
    attack,
    health: maxHealth - damage,
    maxHealth,
    golden,
    tier: base.tier,
    tribes: base.tribes,
    position,
    keywords,
    enchantments: [],
    tags,
  };
}

export function boardOf(specs: M[]): MinionSnapshot[] {
  return specs.map((s, i) => minion(s, i + 1));
}

function snapshot(turn: number, heroCardId: string, specs: M[], ago = 0): BoardSnapshot {
  return {
    turn,
    heroCardId,
    minions: boardOf(specs),
    heroPowerCardId: db.get(heroCardId)?.heroPowerId,
    capturedAt: Date.now() - ago * 60_000,
  };
}

function shopOffer(cardId: string): ShopOffer {
  const c = db.get(cardId)!;
  return {
    entityId: nextEntity++,
    cardId,
    name: c.name,
    tier: c.tier,
    tribes: c.tribes,
    attack: c.attack ?? 0,
    health: c.health ?? 0,
    golden: false,
    type: c.type === 'MINION' ? 'MINION' : c.type === 'SPELL' ? 'SPELL' : 'OTHER',
  };
}

function heroName(id: string): string {
  return db.get(id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// Lobby used by the live scenes
// ---------------------------------------------------------------------------

export const HERO_OPTIONS = ['BG36_HERO_000', 'BG34_HERO_002', 'TB_BaconShop_HERO_56', 'BG31_HERO_802'];
export const LOCAL_HERO = 'BG36_HERO_000'; // Drest'agath
const LOBBY_TRIBES: Tribe[] = ['ABERRATION', 'BEAST', 'MECHANICAL', 'NAGA', 'UNDEAD'];
const ANOMALY = 'BG27_Anomaly_726'; // Blessed or Blighted

const LOCAL_BOARD_T9: M[] = [
  ['BG36_320', 14, 16], // Mysterious K'Thir
  ['BG36_318', 9, 11], // Faceless Converter
  ['BG36_115', 11, 13, { kw: { taunt: true } }], // Nightmare Corroder
  ['BG36_106', 8, 8, { golden: true }], // Cutthroat K'Thir (golden)
  ['BG36_102', 10, 17], // De-volition-ist
  ['BG36_114', 9, 12, { kw: { divineShield: true } }], // Parasitic Fleshling
  ['BG36_099', 7, 9], // Brain Rotter
];

const DENATHRIUS_BOARD_T9: M[] = [
  ['BG36_511', 9, 14, { kw: { taunt: true } }], // Dead Bellringer
  ['BG25_008', 12, 7, { golden: true }], // Eternal Knight (golden)
  ['BGDUO_112', 6, 15], // Grave Narrator
  ['BG32_880', 11, 6], // Friendly Geist
  ['BG34_690', 9, 5], // Plaguerunner
  ['BG32_340', 8, 9], // Maw Caster
  ['BG25_010', 6, 3, { kw: { reborn: true } }], // Handless Forsaken
];

interface PlayerSpec {
  playerId: number;
  hero: string;
  name: string;
  place: number;
  health: number;
  armor: number;
  tier: number;
  triples: number;
  dead?: number;
  local?: boolean;
  board?: { turn: number; specs: M[] };
  tiers: number[]; // turn reached for tier 2.. (index 0 = tier 2)
  combats: [turn: number, result: CombatRecord['result'], damage: number][];
  health0: number;
}

const PLAYERS: PlayerSpec[] = [
  {
    playerId: 4,
    hero: 'BG20_HERO_100', // Rokara
    name: 'Grimbold#2210',
    place: 1,
    health: 30,
    armor: 6,
    tier: 5,
    triples: 3,
    health0: 48,
    tiers: [2, 4, 6, 8],
    combats: [[8, 'lost', 7]],
    board: {
      turn: 8,
      specs: [
        ['BGS_018', 13, 13], // Goldrinn
        ['BGS_008', 9, 9], // Ghastcoiler
        ['BG36_210', 12, 14], // Hoarding Hyena
        ['BG26_802', 8, 16, { kw: { taunt: true } }], // Banana Slamma
        ['BG36_207', 9, 12], // Wolf Pup
        ['BG35_604', 6, 8], // Sewer Lord
        ['BG31_809', 7, 7], // Turquoise Skitterer
      ],
    },
  },
  {
    playerId: 3,
    hero: LOCAL_HERO,
    name: 'Lukas#1987',
    place: 2,
    health: 30,
    armor: 1,
    tier: 5,
    triples: 2,
    local: true,
    health0: 42,
    tiers: [2, 4, 6, 8],
    combats: [],
    board: { turn: 9, specs: LOCAL_BOARD_T9 },
  },
  {
    playerId: 7,
    hero: 'BG23_HERO_304', // Lady Vashj
    name: 'Nyxara#4411',
    place: 3,
    health: 21,
    armor: 4,
    tier: 4,
    triples: 2,
    health0: 46,
    tiers: [3, 5, 7],
    combats: [
      [2, 'tied', 0],
      [7, 'won', 5],
    ],
    board: {
      turn: 7,
      specs: [
        ['BG23_008', 8, 12, { kw: { divineShield: true } }], // Glowscale
        ['BG26_505', 10, 11], // Zesty Shaker
        ['BG23_007', 6, 12], // Waverider
        ['BG31_920', 7, 9], // Darkcrest Strategist
        ['BG23_009', 4, 9], // Lava Lurker
        ['BG23_000', 6, 12, { golden: true }], // Mini-Myrmidon
        ['BG35_921', 5, 4], // Abyssal Bruiser
      ],
    },
  },
  {
    playerId: 1,
    hero: 'BG31_HERO_811', // Kerrigan
    name: 'Quillstorm#9032',
    place: 4,
    health: 19,
    armor: 0,
    tier: 5,
    triples: 1,
    health0: 44,
    tiers: [2, 5, 6, 9],
    combats: [
      [1, 'tied', 0],
      [6, 'won', 4],
    ],
    board: {
      turn: 6,
      specs: [
        ['BG_BOT_911', 4, 8], // Annoy-o-Module
        ['BG36_506', 7, 4], // Drone Duplicator
        ['BG28_741', 6, 3], // Charging Czarina
        ['BG36_853', 9, 9], // Glambot
        ['BG34_405', 7, 6], // Relentless Deflector
        ['BG36_372', 10, 10], // Holy Vanguard
      ],
    },
  },
  {
    playerId: 6,
    hero: 'BG24_HERO_100', // Sire Denathrius
    name: 'Bonecrusher#7715',
    place: 5,
    health: 15,
    armor: 0,
    tier: 4,
    triples: 1,
    health0: 41,
    tiers: [3, 5, 7],
    combats: [[5, 'lost', 4]],
    board: {
      turn: 5,
      specs: [
        ['BG25_008', 6, 4, { golden: false }],
        ['BGDUO_112', 3, 9],
        ['BG32_880', 7, 4],
        ['BG34_690', 5, 3],
        ['BG25_010', 3, 2, { kw: { reborn: true } }],
      ],
    },
  },
  {
    playerId: 2,
    hero: 'BG22_HERO_007', // Queen Azshara
    name: 'Tidecaller#3301',
    place: 6,
    health: 11,
    armor: 0,
    tier: 4,
    triples: 0,
    health0: 42,
    tiers: [2, 5, 8],
    combats: [[4, 'won', 3]],
    board: {
      turn: 4,
      specs: [
        ['BG36_308', 5, 3], // Faceless Operative
        ['BG36_099', 4, 5], // Brain Rotter
        ['BG23_007', 3, 7], // Waverider
        ['BG36_100', 2, 4], // Wandering Willbreaker
        ['BG23_004', 3, 4], // Deep-Sea Angler
      ],
    },
  },
  {
    playerId: 8,
    hero: 'BG23_HERO_201', // Ozumat
    name: 'Feralmancer#5521',
    place: 7,
    health: 6,
    armor: 0,
    tier: 4,
    triples: 1,
    health0: 45,
    tiers: [3, 5, 8],
    combats: [[3, 'won', 2]],
    board: {
      turn: 3,
      specs: [
        ['BG36_207', 3, 6], // Wolf Pup
        ['BG31_803', 2, 2], // Buzzing Vermin
        ['BG36_200', 2, 5], // Flittering Bat
        ['BG36_098', 4, 3], // Zoatroid
      ],
    },
  },
  {
    playerId: 5,
    hero: 'TB_BaconShop_HERO_18', // Patches the Pirate
    name: 'SirSnipalot#8008',
    place: 8,
    health: 0,
    armor: 0,
    tier: 3,
    triples: 0,
    dead: 8,
    health0: 49,
    tiers: [2, 4],
    combats: [],
    board: {
      turn: 7,
      specs: [
        ['BG29_611', 2, 2, { kw: { divineShield: true } }],
        ['BG25_001', 3, 2],
        ['BG25_008', 5, 3],
        ['BG31_177', 4, 2],
        ['BG25_013', 2, 6],
      ],
    },
  },
];

function buildPlayers(turn: number, nextOpp?: number, overrides?: (p: PlayerState) => void): PlayerState[] {
  return PLAYERS.map((p) => {
    const tierHistory = [{ tier: 1, turn: 1 }, ...p.tiers.filter((t) => t <= turn).map((t, i) => ({ tier: i + 2, turn: t }))];
    const healthHistory: { turn: number; value: number }[] = [];
    let v = p.health0;
    const end = p.health + p.armor;
    const last = p.dead ?? turn - 1;
    for (let t = 1; t <= last; t++) {
      const remaining = last - t;
      const step = remaining === 0 ? v - end : Math.max(0, Math.round(((v - end) / (remaining + 1)) * (0.6 + ((t * 7) % 5) / 6)));
      v = Math.max(end, v - (t < 3 ? 0 : step));
      if (t === last) v = end;
      healthHistory.push({ turn: t, value: v });
    }
    const st: PlayerState = {
      playerId: p.playerId,
      heroEntityId: 40 + p.playerId,
      heroCardId: p.hero,
      heroName: heroName(p.hero),
      name: p.name,
      isLocal: !!p.local,
      health: p.health,
      maxHealth: 30,
      armor: p.armor,
      tavernTier: p.tier,
      triples: p.triples,
      leaderboardPlace: p.place,
      dead: !!p.dead,
      diedOnTurn: p.dead,
      isNextOpponent: p.playerId === nextOpp,
      lastBoard: p.board ? snapshot(p.board.turn, p.hero, p.board.specs, (turn - p.board.turn) * 1.5) : undefined,
      tierHistory,
      combatsAgainst: p.combats.map(([t, result, damage]) => ({
        turn: t,
        opponentPlayerId: p.playerId,
        opponentHeroCardId: p.hero,
        result,
        damage,
      })),
      healthHistory,
      heroPowerCardId: db.get(p.hero)?.heroPowerId,
      mainTribes: p.board ? mainTribes(p.board.specs) : undefined,
    };
    overrides?.(st);
    return st;
  });
}

function mainTribes(specs: M[]): Tribe[] {
  const counts = new Map<Tribe, number>();
  for (const [id] of specs) for (const t of db.get(id)?.tribes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}

function baseState(): BgGameState {
  return {
    gameId: 'demo-game-0001',
    active: true,
    buildNumber: db.build,
    gameType: 'GT_BATTLEGROUNDS',
    mode: 'solo',
    spectating: false,
    phase: 'recruit',
    turn: 9,
    localPlayerId: 3,
    localPlayerName: 'Lukas#1987',
    heroOptions: [],
    chosenHeroCardId: LOCAL_HERO,
    players: [],
    availableTribes: LOBBY_TRIBES,
    tribesSource: 'log',
    anomalyCardId: ANOMALY,
    trinketsActive: true,
    questsActive: false,
    shop: [],
    localBoard: [],
    localHand: [],
    gold: 10,
    maxGold: 10,
    battle: { status: 'idle', turn: 9 },
    battles: [],
    startedAt: Date.now() - 14 * 60_000,
  };
}

const LOCAL_COMBATS: [number, number, CombatRecord['result'], number, number][] = [
  // turn, opponentPlayerId, result, damage, predicted win %
  [1, 1, 'tied', 0, 22],
  [2, 7, 'tied', 0, 31],
  [3, 8, 'won', 2, 64],
  [4, 2, 'won', 3, 71],
  [5, 6, 'lost', 4, 38],
  [6, 1, 'won', 4, 57],
  [7, 7, 'won', 5, 66],
  [8, 4, 'lost', 7, 29],
];

function pastBattles(upToTurn: number): BattleState[] {
  return LOCAL_COMBATS.filter(([t]) => t <= upToTurn).map(([turn, , result, damage, win]) => {
    const loss = Math.max(0, Math.round((100 - win) * 0.82 * 10) / 10);
    const tie = Math.round((100 - win - loss) * 10) / 10;
    return {
      status: 'done',
      turn,
      result: {
        win,
        tie,
        loss,
        avgDamageDealt: 3 + (turn % 4),
        avgDamageTaken: 4 + (turn % 3),
        lethalWin: 0,
        lethalLoss: 0,
        iterations: 4000,
        durationMs: 180 + turn * 9,
        unsupported: [],
      },
      actual: { result, damage },
    } satisfies BattleState;
  });
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export function heroSelectionState(): BgGameState {
  const s = baseState();
  s.phase = 'heroSelection';
  s.turn = 0;
  s.chosenHeroCardId = undefined;
  s.heroOptions = HERO_OPTIONS.map((id, i) => ({
    entityId: 60 + i,
    cardId: id,
    name: heroName(id),
    baseCardId: id,
    heroPowerCardId: db.get(id)?.heroPowerId,
    armor: db.get(id)?.armor,
  }));
  s.players = [];
  s.battle = { status: 'idle', turn: 0 };
  s.startedAt = Date.now() - 30_000;
  s.gold = undefined;
  // Hearthstone's log does not list the lobby's tribes at hero selection: they are
  // inferred from shop offers on turn 1-2.
  s.availableTribes = [];
  s.tribesSource = 'unknown';
  s.anomalyCardId = undefined;
  return s;
}

/** Lesser trinket offer on turn 6 (one Pirate trinket in a lobby without Pirates). */
export const TRINKET_OFFER = ['BG30_MagicItem_924', 'BG35_MagicItem_301', 'BG36_MagicItem_201', 'BG36_MagicItem_206'];

export function trinketPickState(): BgGameState {
  const s = recruitState();
  s.turn = 6;
  s.tribesSource = 'inferred';
  s.players = buildPlayers(6, 7);
  s.nextOpponentPlayerId = 7;
  s.battles = pastBattles(5);
  s.battle = s.battles[s.battles.length - 1];
  s.localBoard = boardOf(LOCAL_BOARD_T9.slice(0, 5).map(([id]) => [id] as M));
  s.trinketOptions = TRINKET_OFFER.map(
    (cardId, i): TrinketOption => ({ entityId: 900 + i, cardId, name: db.get(cardId)?.name ?? cardId, cost: db.get(cardId)?.cost }),
  );
  return s;
}

export function recruitState(): BgGameState {
  const s = baseState();
  s.players = buildPlayers(9, 6);
  s.nextOpponentPlayerId = 6;
  s.localBoard = boardOf(LOCAL_BOARD_T9);
  s.localHand = boardOf([['BG36_097', 3, 9]]);
  s.shop = ['BG36_320', 'BG36_514', 'BG36_366', 'BGS_008', 'BG36_102', 'BG25_009', 'BG36_303'].map(shopOffer);
  s.battles = pastBattles(8);
  s.battle = s.battles[s.battles.length - 1];
  return s;
}

export function combatInput(): BattleSimInput {
  const side = (playerId: number, hero: string, tier: number, health: number, armor: number, specs: M[]): SimSide => ({
    playerId,
    heroCardId: hero,
    heroPowerCardId: db.get(hero)?.heroPowerId,
    tavernTier: tier,
    health,
    armor,
    minions: boardOf(specs),
    hand: [],
    trinkets: [],
    questRewards: [],
    playerTags: {},
    heroTags: {},
  });
  return {
    turn: 9,
    player: side(3, LOCAL_HERO, 5, 30, 1, LOCAL_BOARD_T9),
    opponent: side(6, 'BG24_HERO_100', 4, 15, 0, DENATHRIUS_BOARD_T9),
    anomalyCardId: ANOMALY,
    availableTribes: LOBBY_TRIBES,
    mode: 'solo',
    damageCap: 15,
  };
}

/** Fallback prediction used by the demo when the simulator worker is unavailable. */
export const SAMPLE_SIM_RESULT = {
  win: 58.4,
  tie: 6.1,
  loss: 35.5,
  avgDamageDealt: 8.6,
  avgDamageTaken: 7.9,
  lethalWin: 0,
  lethalLoss: 0,
  iterations: 4000,
  durationMs: 412,
  unsupported: ['BG36_102', 'BGDUO_112'],
};

export function combatState(): BgGameState {
  const s = baseState();
  s.phase = 'combat';
  s.players = buildPlayers(9, undefined, (p) => {
    if (p.playerId === 6) p.lastBoard = snapshot(9, p.heroCardId, DENATHRIUS_BOARD_T9);
  });
  s.currentOpponentPlayerId = 6;
  s.localBoard = boardOf(LOCAL_BOARD_T9);
  s.battles = pastBattles(8);
  s.battle = { status: 'simulating', turn: 9, input: combatInput() };
  return s;
}

export function gameOverState(): BgGameState {
  const s = baseState();
  s.phase = 'gameOver';
  s.turn = 14;
  s.finalPlacement = 2;
  s.endedAt = Date.now();
  const extra: [number, number, CombatRecord['result'], number, number][] = [
    [9, 6, 'won', 9, 58],
    [10, 2, 'won', 11, 81],
    [11, 1, 'lost', 6, 47],
    [12, 7, 'won', 8, 62],
    [13, 4, 'lost', 12, 34],
    [14, 4, 'lost', 15, 26],
  ];
  LOCAL_COMBATS.push(...extra.filter((e) => !LOCAL_COMBATS.some((c) => c[0] === e[0])));
  s.battles = pastBattles(14);
  s.battle = s.battles[s.battles.length - 1];
  s.players = buildPlayers(14, undefined, (p) => {
    const finals: Record<number, [number, number]> = { 4: [1, 22], 3: [2, 0], 1: [3, 0], 7: [4, 0], 6: [5, 0], 2: [6, 0], 8: [7, 0], 5: [8, 0] };
    const [place, hp] = finals[p.playerId];
    p.leaderboardPlace = place;
    p.dead = p.playerId !== 4;
    p.health = hp;
    p.armor = 0;
    p.diedOnTurn = { 3: 14, 1: 13, 7: 12, 6: 11, 2: 10, 8: 9, 5: 8 }[p.playerId] as number | undefined;
    if (p.isLocal) {
      p.tavernTier = 6;
      p.tierHistory = [...p.tierHistory, { tier: 6, turn: 11 }];
    }
  });
  s.localBoard = boardOf([
    ['BG36_320', 24, 27], // Mysterious K'Thir
    ['BG36_111', 31, 36], // Sha of Fear
    ['BG36_115', 19, 22, { kw: { taunt: true } }],
    ['BG36_106', 14, 15, { golden: true }],
    ['BG36_102', 18, 26],
    ['BG36_109', 21, 24, { kw: { divineShield: true } }], // The Shadow of Doubt
    ['BG36_104', 16, 11], // Dark Puppeteer
  ]);
  return s;
}

export function idleState(): BgGameState {
  const s = baseState();
  s.active = false;
  s.phase = 'idle';
  s.turn = 0;
  s.players = [];
  return s;
}

// ---------------------------------------------------------------------------
// History (deterministic, ~25 matches)
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HISTORY_HEROES = [
  'BG31_HERO_802', // Artanis
  'BG36_HERO_000', // Drest'agath
  'BG20_HERO_100', // Rokara
  'BG23_HERO_304', // Lady Vashj
  'TB_BaconShop_HERO_56', // Alexstrasza
  'BG22_HERO_007', // Queen Azshara
  'BG24_HERO_100', // Sire Denathrius
  'BG31_HERO_811', // Kerrigan
  'TB_BaconShop_HERO_18', // Patches
  'BG36_HERO_101', // Tras'tath
  'BG34_HERO_001', // Chromie
  'TB_BaconShop_HERO_52', // Deathwing
  'BG25_HERO_100', // Putricide
  'BG28_HERO_400', // Snake Eyes
  'BG36_HERO_105', // Xavius
];

/** [lesser, greater] trinkets cycled through the sample history. */
const HISTORY_TRINKETS: [string, string][] = [
  ['BG35_MagicItem_301', 'BG30_MagicItem_418'],
  ['BG36_MagicItem_206', 'BG36_MagicItem_450'],
  ['BG36_MagicItem_201', 'BG35_MagicItem_742'],
  ['BG30_MagicItem_888', 'BG30_MagicItem_442'],
  ['BG35_MagicItem_301', 'BG36_MagicItem_215'],
];

const PLACEMENTS = [2, 4, 1, 6, 3, 5, 2, 8, 4, 3, 1, 7, 5, 2, 4, 3, 6, 1, 4, 2, 5, 3, 7, 2, 4];
const OPP_NAMES = ['Grimbold', 'Nyxara', 'Quillstorm', 'Bonecrusher', 'Tidecaller', 'Feralmancer', 'SirSnipalot', 'Vexmoor', 'Oakhart', 'Ziggles', 'Morwen', 'Thalric'];

export function sampleHistory(): MatchRecord[] {
  const r = rng(1337);
  const pool = db.poolMinions();
  const now = Date.now();
  const records: MatchRecord[] = [];
  const n = PLACEMENTS.length;
  for (let i = 0; i < n; i++) {
    // i = 0 newest. 5 games today, the rest spread over the past 9 days.
    const startedAt = i < 5 ? now - (i + 1) * 31 * 60_000 : now - (1 + Math.floor((i - 5) / 2.4)) * 86_400_000 - Math.floor(r() * 6) * 3_600_000;
    const placement = PLACEMENTS[i];
    const hero = HISTORY_HEROES[(i * 7 + (i % 3)) % HISTORY_HEROES.length];
    const lobby = [...LOBBY_TRIBES_ALL].sort(() => r() - 0.5).slice(0, 5);
    const main = lobby[Math.floor(r() * lobby.length)];
    const turns = Math.round(placement <= 2 ? 14 + r() * 4 : placement <= 4 ? 12 + r() * 3 : 8 + r() * 4);
    const finalTier = Math.min(7, placement <= 2 ? 6 : placement <= 4 ? 5 + Math.round(r()) : 3 + Math.round(r() * 2));
    const candidates = pool.filter((c) => (c.tier ?? 1) <= finalTier && (c.tribes.includes(main) || (c.tribes.length === 0 && r() < 0.15)));
    const picks = [...candidates].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) + (r() - 0.5) * 3).slice(0, 7);
    const scale = 1 + turns / 6;
    const finalBoard = picks.map((c, idx) =>
      minion(
        [
          c.id,
          Math.round((c.attack ?? 1) * scale + r() * turns),
          Math.round((c.health ?? 1) * scale + r() * turns),
          { golden: r() < 0.18 },
        ],
        idx + 1,
      ),
    );
    const tierHistory = [{ tier: 1, turn: 1 }];
    let t = 1;
    for (let tier = 2; tier <= finalTier; tier++) {
      t += tier === 2 ? 1 : 1 + Math.round(r() * 2);
      tierHistory.push({ tier, turn: Math.min(t, turns) });
    }
    const combats: CombatRecord[] = [];
    let hp = 30 + (db.get(hero)?.armor ?? 10);
    const healthHistory: { turn: number; value: number }[] = [];
    for (let turn = 1; turn <= turns; turn++) {
      const winBias = (9 - placement) / 9;
      const roll = r();
      const result: CombatRecord['result'] = roll < 0.12 ? 'tied' : roll < 0.12 + winBias * 0.8 ? 'won' : 'lost';
      const damage = result === 'tied' ? 0 : Math.max(1, Math.round(turn / 2 + r() * 6));
      const win = Math.round((result === 'won' ? 50 + r() * 45 : result === 'lost' ? 5 + r() * 45 : 20 + r() * 40) * 10) / 10;
      const loss = Math.round(Math.max(0, (100 - win) * (0.7 + r() * 0.3)) * 10) / 10;
      combats.push({
        turn,
        opponentPlayerId: 1 + Math.floor(r() * 7),
        opponentHeroCardId: HISTORY_HEROES[Math.floor(r() * HISTORY_HEROES.length)],
        result,
        damage,
        prediction:
          turn > 1
            ? {
                win,
                loss,
                tie: Math.round((100 - win - loss) * 10) / 10,
                avgDamageDealt: 3 + r() * 8,
                avgDamageTaken: 3 + r() * 8,
                lethalWin: 0,
                lethalLoss: 0,
                iterations: 4000,
                durationMs: 300,
                unsupported: [],
              }
            : undefined,
      });
      if (result === 'lost') hp -= damage;
      if (placement > 1 && turn === turns) hp = 0;
      healthHistory.push({ turn, value: Math.max(0, hp) });
    }
    const otherHeroes = HISTORY_HEROES.filter((h) => h !== hero).sort(() => r() - 0.5);
    const places = [1, 2, 3, 4, 5, 6, 7, 8].filter((p) => p !== placement);
    const lobbyPlayers = [
      { playerId: 1, heroCardId: hero, place: placement, name: 'Lukas#1987' },
      ...places.map((p, k) => ({ playerId: k + 2, heroCardId: otherHeroes[k], place: p, name: `${OPP_NAMES[(i + k) % OPP_NAMES.length]}#${1000 + Math.floor(r() * 9000)}` })),
    ];
    const ratingAfterDelta = [0, 98, 62, 31, 8, -18, -42, -66, -91][placement];
    records.push({
      id: `hist-${String(i).padStart(3, '0')}`,
      startedAt,
      endedAt: startedAt + turns * 95_000,
      mode: 'solo',
      gameType: 'GT_BATTLEGROUNDS',
      heroCardId: hero,
      heroName: heroName(hero),
      baseHeroCardId: hero,
      heroOptions: [hero, ...otherHeroes.slice(0, 3)],
      placement,
      turns,
      finalTier,
      finalBoard,
      availableTribes: lobby,
      anomalyCardId: undefined,
      tierHistory,
      combats,
      healthHistory,
      lobby: lobbyPlayers,
      trinkets: turns >= 9 ? [HISTORY_TRINKETS[i % HISTORY_TRINKETS.length][0], HISTORY_TRINKETS[(i * 3 + 1) % HISTORY_TRINKETS.length][1]] : turns >= 6 ? [HISTORY_TRINKETS[i % HISTORY_TRINKETS.length][0]] : [],
      ratingBefore: 6400 + (n - i) * 9,
      ratingAfter: 6400 + (n - i) * 9 + ratingAfterDelta,
    });
  }
  return records;
}

const LOBBY_TRIBES_ALL: Tribe[] = ['ABERRATION', 'BEAST', 'DEMON', 'DRAGON', 'ELEMENTAL', 'MECHANICAL', 'MURLOC', 'NAGA', 'PIRATE', 'QUILBOAR', 'UNDEAD'];

// ---------------------------------------------------------------------------
// Community hero stats (hand-written sample, shaped like a real provider)
// ---------------------------------------------------------------------------

/**
 * Community hero stats from a real snapshot of Firestone's public data (see
 * sampleCommunity.ts), with per-tribe placements and relative tiers like the main process.
 */
export function communityStats(): HeroStatsBundle {
  const stats: HeroStat[] = COMMUNITY_HEROES.map(([heroCardId, avgPlacement, games, top4Rate, pickRate, tribes]) => ({
    heroCardId,
    avgPlacement,
    games,
    top4Rate,
    pickRate,
    tribeStats: tribes
      .split('|')
      .filter(Boolean)
      .map((row) => {
        const [tribe, n, avg, without, impact] = row.split(' ');
        return { tribe: tribe as Tribe, games: Number(n), avgPlacement: Number(avg), avgPlacementWithout: Number(without), impact: Number(impact) };
      }),
  }));
  const mean = stats.reduce((a, s) => a + s.avgPlacement, 0) / stats.length;
  const sd = Math.sqrt(stats.reduce((a, s) => a + (s.avgPlacement - mean) ** 2, 0) / stats.length) || 1;
  for (const s of stats) {
    const z = (s.avgPlacement - mean) / sd;
    s.tier = z <= -1.25 ? 'S' : z <= -0.4 ? 'A' : z <= 0.4 ? 'B' : z <= 1.25 ? 'C' : 'D';
  }
  return {
    source: 'community',
    label: 'Community (Firestone public data)',
    updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    mode: 'solo',
    stats,
  };
}

export function communityTrinketStats(): TrinketStatsBundle {
  return {
    source: 'community',
    label: 'Community (Firestone public data)',
    updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    stats: COMMUNITY_TRINKETS.filter(([id]) => db.get(id)).map(([trinketCardId, avgPlacement, games, pickRate]) => ({ trinketCardId, avgPlacement, games, pickRate })),
  };
}

export function sampleStatus(): AppStatus {
  return {
    version: '1.0.0',
    platform: 'win32',
    hearthstoneInstallPath: 'C:\\Program Files (x86)\\Hearthstone',
    logsPath: 'C:\\Program Files (x86)\\Hearthstone\\Logs',
    powerLogPath: 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_11_05_14_02_11\\Power.log',
    logConfig: 'ok',
    hearthstoneRunning: true,
    gameWindow: { found: true, focused: true, minimized: false, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    watching: true,
    demo: { running: false },
    cardData: { build: db.build, patch: db.patch, source: db.data.source, cards: db.size },
    errors: [],
  };
}
