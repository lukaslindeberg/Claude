/**
 * Shared data contract for Tavern Lens.
 *
 * Every module (log parser, game tracker, battle simulator, Electron main process,
 * renderer UI) talks through these types. Keep them serialisable (plain JSON, no
 * classes, no Maps) because they cross the Electron IPC boundary and web workers.
 */

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Hearthstone Race enum names used by Battlegrounds tribes. `ALL` = Amalgam-style "all types". */
export type Tribe =
  | 'ABERRATION'
  | 'BEAST'
  | 'DEMON'
  | 'DRAGON'
  | 'ELEMENTAL'
  | 'MECHANICAL'
  | 'MURLOC'
  | 'NAGA'
  | 'PIRATE'
  | 'QUILBOAR'
  | 'UNDEAD'
  | 'ALL';

/** The tribes that can rotate in/out of a lobby (patch 37: 11 tribes incl. Aberration). */
export const LOBBY_TRIBES: Tribe[] = [
  'ABERRATION',
  'BEAST',
  'DEMON',
  'DRAGON',
  'ELEMENTAL',
  'MECHANICAL',
  'MURLOC',
  'NAGA',
  'PIRATE',
  'QUILBOAR',
  'UNDEAD',
];

export const TRIBE_LABELS: Record<Tribe, string> = {
  ABERRATION: 'Aberration',
  BEAST: 'Beast',
  DEMON: 'Demon',
  DRAGON: 'Dragon',
  ELEMENTAL: 'Elemental',
  MECHANICAL: 'Mech',
  MURLOC: 'Murloc',
  NAGA: 'Naga',
  PIRATE: 'Pirate',
  QUILBOAR: 'Quilboar',
  UNDEAD: 'Undead',
  ALL: 'All',
};

export type BgCardType =
  | 'MINION'
  | 'HERO'
  | 'HERO_POWER'
  | 'SPELL' // tavern spells (BATTLEGROUND_SPELL)
  | 'ANOMALY'
  | 'TRINKET'
  | 'QUEST'
  | 'REWARD' // quest rewards
  | 'ENCHANTMENT'
  | 'OTHER';

/**
 * Compact Battlegrounds card definition. Generated at build time from HearthSim
 * hsdata (CardDefs.Bacon.xml) and refreshable at runtime from HearthstoneJSON.
 */
export interface BgCard {
  id: string; // CardID, e.g. "BG21_029"
  dbfId: number;
  name: string;
  /** Card text with Hearthstone markup converted to simple HTML (<b>, <i>, <br>). */
  text?: string;
  type: BgCardType;
  /** Tavern tier (TECH_LEVEL). */
  tier?: number;
  attack?: number;
  health?: number;
  cost?: number;
  /** Tribes; multi-tribe minions list all of them. Empty for neutral. */
  tribes: Tribe[];
  /**
   * Boolean mechanics/keywords present on the card, as GameTag names, e.g.
   * TAUNT, DIVINE_SHIELD, DEATHRATTLE, START_OF_COMBAT, AVENGE, BATTLECRY,
   * MAGNETIC, REBORN, WINDFURY, MEGA_WINDFURY, VENOMOUS, POISONOUS, CLEAVE,
   * STEALTH, OVERKILL, SPELLCRAFT, REBORN, CHOOSE_ONE, TRIGGER_VISUAL, ...
   */
  mechanics: string[];
  /** True if the card is currently in the shop pool (IS_BACON_POOL_MINION or pool spell). */
  pool: boolean;
  /** For a normal minion: the golden version's card id. */
  goldenId?: string;
  /** For a golden minion: the normal version's card id. */
  normalId?: string;
  golden?: boolean;
  /** For heroes: their hero power card id. */
  heroPowerId?: string;
  /** For heroes: the hero's buddy card id, if any. */
  buddyId?: string;
  /** For hero skins: the base hero card id (stats are aggregated on the base hero). */
  skinParentId?: string;
  /** For heroes: default starting armor from the card definition. */
  armor?: number;
  /** Selected numeric tags useful to the simulator (e.g. TAG_SCRIPT_DATA_NUM_1). */
  tags?: Record<string, number>;
  /** Card mechanics that change Battlegrounds combat or shop, e.g. Timewarped (BACON_TIMEWARPED). */
  timewarped?: boolean;
  /**
   * Tribes the card's text refers to (e.g. a trinket that buffs Beasts). Used to flag
   * heroes/trinkets that need tribes missing from the lobby.
   */
  relatedTribes?: Tribe[];
  /** Duos-only card. */
  duosOnly?: boolean;
  /** Solo-only card. */
  soloOnly?: boolean;
}

export interface BgCardData {
  /** Hearthstone client build the data was generated from. */
  build: number;
  /** Human readable patch, e.g. "37.0.2" (if known). */
  patch?: string;
  generatedAt: string; // ISO date
  source: 'hsdata' | 'hearthstonejson';
  locale: string; // "enUS"
  cards: BgCard[];
}

// ---------------------------------------------------------------------------
// Live game state (produced by the BG tracker in src/core/bg)
// ---------------------------------------------------------------------------

export type GamePhase = 'idle' | 'heroSelection' | 'recruit' | 'combat' | 'gameOver';
export type GameMode = 'solo' | 'duos';

export interface MinionKeywords {
  taunt?: boolean;
  divineShield?: boolean;
  poisonous?: boolean;
  venomous?: boolean;
  windfury?: boolean;
  megaWindfury?: boolean;
  reborn?: boolean;
  stealth?: boolean;
  cleave?: boolean;
  deathrattle?: boolean;
  startOfCombat?: boolean;
  avenge?: boolean;
  magnetic?: boolean;
}

export interface EnchantmentSnapshot {
  entityId: number;
  cardId: string;
  /** Card id of the entity that created the enchantment, if known. */
  creatorCardId?: string;
  scriptData1?: number; // TAG_SCRIPT_DATA_NUM_1
  scriptData2?: number; // TAG_SCRIPT_DATA_NUM_2
}

export interface MinionSnapshot {
  entityId: number;
  cardId: string;
  name: string;
  attack: number;
  /** Current health (HEALTH - DAMAGE). */
  health: number;
  /** HEALTH tag (max health). */
  maxHealth: number;
  golden: boolean;
  tier?: number;
  tribes: Tribe[];
  /** 1-based ZONE_POSITION on board (0 if unknown). */
  position: number;
  keywords: MinionKeywords;
  enchantments: EnchantmentSnapshot[];
  /**
   * All tags of the entity at snapshot time, by GameTag name (or numeric string
   * if the name is unknown). The simulator reads whatever it needs from here.
   */
  tags: Record<string, number>;
}

export interface BoardSnapshot {
  /** BG turn number (1-based shop turn number, i.e. ceil(GameEntity TURN / 2)). */
  turn: number;
  heroCardId: string;
  minions: MinionSnapshot[];
  /** Quest rewards / trinkets / hero power state seen with the board, if known. */
  heroPowerCardId?: string;
  trinkets?: string[];
  questRewards?: string[];
  /** Epoch ms when captured. */
  capturedAt: number;
}

export interface CombatRecord {
  /** BG turn the combat happened on. */
  turn: number;
  opponentPlayerId: number;
  opponentHeroCardId: string;
  result: 'won' | 'lost' | 'tied';
  /** Damage dealt to the loser (0 on tie). Positive number. */
  damage: number;
  /** Simulator prediction made before the combat, if any. */
  prediction?: BattleSimResult;
}

export interface PlayerState {
  /** Battlegrounds lobby slot id: the PLAYER_ID tag on the leaderboard hero entity. */
  playerId: number;
  /** Entity id of the leaderboard hero entity (the persistent one, not combat copies). */
  heroEntityId: number;
  heroCardId: string;
  heroName: string;
  /** BattleTag / display name if known (local player always, opponents once seen in combat). */
  name?: string;
  isLocal: boolean;
  /** Duos: is this our teammate. */
  isTeammate?: boolean;
  /** Duos: team id (players sharing a team have the same value). */
  teamId?: number;
  /** HEALTH - DAMAGE of the hero (does not include armor). Duos: the team's shared health. */
  health: number;
  maxHealth: number;
  armor: number;
  /** PLAYER_TECH_LEVEL. */
  tavernTier: number;
  /** PLAYER_TRIPLES. */
  triples: number;
  /** PLAYER_LEADERBOARD_PLACE (1 = first). */
  leaderboardPlace: number;
  dead: boolean;
  /** Turn on which the player died. */
  diedOnTurn?: number;
  isNextOpponent: boolean;
  /** Last board this player fielded against us (or against anyone we saw). */
  lastBoard?: BoardSnapshot;
  /** Turn at which each tier was reached, e.g. [{tier:2, turn:2}, {tier:3, turn:5}]. */
  tierHistory: { tier: number; turn: number }[];
  /** Our combats against this player (from our perspective). */
  combatsAgainst: CombatRecord[];
  /** Health (health+armor) after each combat, for sparkline: [{turn, value}]. */
  healthHistory: { turn: number; value: number }[];
  heroPowerCardId?: string;
  trinkets?: string[];
  questRewards?: string[];
  /** Cards of tribes this player is known to play, computed from lastBoard. */
  mainTribes?: Tribe[];
}

export interface TrinketOption {
  entityId: number;
  cardId: string;
  name: string;
  /** Gold cost shown on the trinket, if any. */
  cost?: number;
}

export interface HeroOption {
  entityId: number;
  cardId: string;
  name: string;
  /** Base hero card id (skins resolved). */
  baseCardId: string;
  heroPowerCardId?: string;
  armor?: number;
}

export interface ShopOffer {
  entityId: number;
  cardId: string;
  name: string;
  tier?: number;
  tribes: Tribe[];
  attack: number;
  health: number;
  golden: boolean;
  type: 'MINION' | 'SPELL' | 'OTHER';
}

export interface BattleState {
  status: 'idle' | 'waiting' | 'simulating' | 'done' | 'error';
  /** BG turn of the combat this refers to. */
  turn: number;
  input?: BattleSimInput;
  result?: BattleSimResult;
  /** Filled after the combat resolved. */
  actual?: { result: 'won' | 'lost' | 'tied'; damage: number };
  error?: string;
}

/**
 * Local-player counters. Each field is present only when relevant: Blood Gem / Beetle
 * stats when such cards are involved (or the value is above default), the others
 * when non-zero.
 */
export interface BgCounters {
  /** Stats one Blood Gem currently gives (base +1/+1 plus BACON_BLOODGEMBUFF*VALUE). */
  bloodGem?: { attack: number; health: number };
  /** Current stats of your Beetles (2/2 base). */
  beetle?: { attack: number; health: number };
  /** BACON_PLAYER_EXTRA_GOLD_NEXT_TURN. */
  extraGoldNextTurn?: number;
  /** BACON_PLAYER_OVERDRAWN_GOLD_NEXT_TURN (gold you will be missing next turn). */
  overdrawnGoldNextTurn?: number;
  /** BACON_FREE_REFRESH_COUNT (Refresh button / free-refresh player enchantment). */
  freeRefreshes?: number;
}

export interface BgGameState {
  /** Unique id for this game (stable for the game's duration). */
  gameId: string;
  /** True while inside a Battlegrounds game. */
  active: boolean;
  buildNumber?: number;
  /** Raw GameType from the log, e.g. GT_BATTLEGROUNDS, GT_BATTLEGROUNDS_DUO. */
  gameType: string;
  mode: GameMode;
  spectating: boolean;
  phase: GamePhase;
  /** BG turn number (1-based). 0 before the first shop turn. */
  turn: number;
  /** PLAYER_ID (lobby slot) of the local player. */
  localPlayerId?: number;
  localPlayerName?: string;
  heroOptions: HeroOption[];
  /** Trinkets currently offered to the local player (lesser/greater trinket picks). */
  trinketOptions?: TrinketOption[];
  /** Card id of the hero the local player picked (once known). */
  chosenHeroCardId?: string;
  players: PlayerState[];
  nextOpponentPlayerId?: number;
  /** Duos: the next opponent's teammate (NEXT_OPPONENT_TEAMMATE_PLAYER_ID): you fight both. */
  nextOpponentTeammatePlayerId?: number;
  /** During combat: PLAYER_ID of the current opponent. */
  currentOpponentPlayerId?: number;
  /** Tribes known to be in the lobby. */
  availableTribes: Tribe[];
  /** How `availableTribes` was determined. */
  tribesSource: 'log' | 'inferred' | 'unknown';
  /** Anomaly card id (BACON_GLOBAL_ANOMALY_DBID). */
  anomalyCardId?: string;
  trinketsActive?: boolean;
  questsActive?: boolean;
  /** Current shop offers (recruit phase only). */
  shop: ShopOffer[];
  /** Local player's current board (recruit phase). */
  localBoard: MinionSnapshot[];
  /** Local player's hand (minions and spells). */
  localHand: MinionSnapshot[];
  /** Local player's gold (RESOURCES - RESOURCES_USED + TEMP_RESOURCES). */
  gold?: number;
  maxGold?: number;
  /** Small local-player counters (Blood Gems, Beetles, gold next turn, free refreshes). */
  counters?: BgCounters;
  battle: BattleState;
  /** History of battles this game (newest last). */
  battles: BattleState[];
  /** Final placement once the game ended (1-8; duos 1-4). */
  finalPlacement?: number;
  startedAt: number;
  endedAt?: number;
}

/** Discrete events emitted by the tracker alongside state updates. */
export type BgEvent =
  | { type: 'gameStart'; gameId: string; mode: GameMode; gameType: string; spectating: boolean }
  | { type: 'heroOptions'; options: HeroOption[] }
  | { type: 'heroChosen'; cardId: string }
  | { type: 'turnStart'; turn: number }
  | { type: 'combatStart'; turn: number; input: BattleSimInput }
  | { type: 'combatEnd'; turn: number; record: CombatRecord }
  | { type: 'playerDied'; playerId: number; turn: number }
  | { type: 'gameEnd'; record: MatchRecord };

// ---------------------------------------------------------------------------
// Battle simulation (src/core/sim)
// ---------------------------------------------------------------------------

export interface SimSide {
  playerId: number;
  heroCardId: string;
  heroPowerCardId?: string;
  /** Whether the hero power was used this turn / is active, and its script data. */
  heroPowerUsed?: boolean;
  heroPowerData?: { scriptData1?: number; scriptData2?: number; scriptData3?: number };
  /** Additional hero powers in play (e.g. from Reinvigorating Light "Discover a second Hero Power"). */
  extraHeroPowers?: { cardId: string; used?: boolean; scriptData1?: number; scriptData2?: number; scriptData3?: number }[];
  tavernTier: number;
  /** health incl. armor is NOT combined: health and armor separately. */
  health: number;
  armor: number;
  minions: MinionSnapshot[];
  /** Cards in hand (some effects interact with hand). */
  hand: MinionSnapshot[];
  trinkets: { cardId: string; scriptData1?: number; scriptData2?: number }[];
  questRewards: string[];
  /** Secrets in play (Akazamzarak's TB_Bacon_Secrets_*), card ids. */
  secrets?: string[];
  /** Tags of the Player entity (e.g. blood gem buffs, undead attack bonus counters). */
  playerTags: Record<string, number>;
  /** Tags of the hero entity. */
  heroTags: Record<string, number>;
  /** Duos: teammate's board, which joins when this side's board is exhausted. */
  teammate?: Omit<SimSide, 'teammate'>;
}

export interface BattleSimInput {
  turn: number;
  player: SimSide;
  opponent: SimSide;
  anomalyCardId?: string;
  availableTribes: Tribe[];
  mode: GameMode;
  /** Damage cap applied to the loser this turn, if known (BACON damage cap). */
  damageCap?: number;
}

export interface BattleSimOptions {
  /** Max number of simulated combats (default 5000). */
  iterations?: number;
  /** Stop after this many ms even if iterations not reached (default 1500). */
  maxDurationMs?: number;
  /** Seed for deterministic runs (tests). */
  seed?: number;
}

export interface BattleSimResult {
  /** Percentages 0..100. */
  win: number;
  tie: number;
  loss: number;
  /** Average damage dealt to opponent when we win. */
  avgDamageDealt: number;
  /** Average damage taken when we lose. */
  avgDamageTaken: number;
  /** Chance (0..100) that the combat kills the opponent / us. */
  lethalWin: number;
  lethalLoss: number;
  iterations: number;
  durationMs: number;
  /**
   * Card ids present in the combat whose special effects are not (fully)
   * implemented by the simulator. The UI should flag the result as approximate.
   */
  unsupported: string[];
  /** Distribution of damage outcomes: positive = we deal damage, negative = we take. key = damage, value = probability 0..1 */
  damageDistribution?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Persistence: match history & hero stats
// ---------------------------------------------------------------------------

export interface MatchRecord {
  id: string; // gameId
  startedAt: number;
  endedAt: number;
  mode: GameMode;
  gameType: string;
  heroCardId: string;
  heroName: string;
  /** Base hero id (skin resolved) for aggregation. */
  baseHeroCardId: string;
  heroOptions: string[]; // offered hero card ids
  placement: number;
  turns: number;
  finalTier: number;
  finalBoard: MinionSnapshot[];
  availableTribes: Tribe[];
  anomalyCardId?: string;
  tierHistory: { tier: number; turn: number }[];
  combats: CombatRecord[];
  /** Health+armor after each turn. */
  healthHistory: { turn: number; value: number }[];
  /** Trinkets the local player picked (card ids). */
  trinkets?: string[];
  /** Quest rewards the local player earned (card ids). */
  questRewards?: string[];
  /** Players in the lobby (hero ids + final places). */
  lobby: { playerId: number; heroCardId: string; place: number; name?: string; /** Duos: team id (shared with the teammate). */ teamId?: number }[];
  /** Optional rating info if the user entered/imported it. */
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface HeroStat {
  heroCardId: string; // base hero id
  /** Average placement (1..8). */
  avgPlacement: number;
  /** Number of games the stat is based on. */
  games: number;
  /** 0..100 */
  top4Rate?: number;
  winRate?: number;
  pickRate?: number;
  /** Placement distribution: index 0 = 1st place share (0..1). */
  placementDistribution?: number[];
  /** Optional tier label computed by the provider: S/A/B/C/D. */
  tier?: 'S' | 'A' | 'B' | 'C' | 'D';
  /** How the hero does depending on which tribes are in the lobby. */
  tribeStats?: TribeSynergy[];
  /** Personal stats only: typical tier-up turns in your top-half games with this hero. */
  tierCurve?: TierTimingCurve;
}

/**
 * Typical turn on which each tavern tier is reached (median over the games), for the
 * tier-up timing hint. Only tiers with enough data are listed.
 */
export interface TierTimingCurve {
  tiers: { tier: number; /** Median turn the tier was first reached. */ turn: number; /** Games that reached it. */ games: number }[];
  /** Games the curve is based on. */
  games: number;
  /** One hero's games, or all heroes'. */
  scope: 'hero' | 'all';
  /** Where the games come from: the user's own top 4 (duos: top 2) games. */
  basis: 'personalTopHalf';
}

/**
 * Placement of a hero (or trinket) in lobbies with a tribe.
 * `impact` < 0 means the tribe helps (lower placement is better).
 */
export interface TribeSynergy {
  tribe: Tribe;
  /** Games with this tribe in the lobby. */
  games: number;
  /** Average placement in lobbies WITH this tribe. */
  avgPlacement: number;
  /** Average placement in lobbies WITHOUT this tribe (if known). */
  avgPlacementWithout?: number;
  /** avgPlacement(with) - overall average placement. Negative = better with this tribe. */
  impact: number;
}

/**
 * Expected placement for a specific lobby: the overall average plus the summed impact of
 * the lobby's tribes (additive approximation; the community data has one tribe at a time).
 */
export interface LobbyEstimate {
  avgPlacement: number;
  /** Tribes used for the estimate (those with data). */
  tribes: Tribe[];
  /** Per-tribe contributions, best (most negative) first. */
  contributions: { tribe: Tribe; impact: number }[];
}

export interface TrinketStat {
  trinketCardId: string;
  avgPlacement: number;
  games: number;
  /** 0..1 share of offers where it was picked (community only). */
  pickRate?: number;
  /** Personal stats only: placement by tribe when you picked it. */
  tribeStats?: TribeSynergy[];
}

export interface TrinketStatsBundle {
  source: 'personal' | 'community';
  label: string;
  updatedAt: string;
  mode?: GameMode;
  stats: TrinketStat[];
}

/** A short play tip for a hero or trinket that needs a specific approach. */
export interface PlayTip {
  /** Base card id (hero or trinket). */
  cardId: string;
  /** One or two short sentences. */
  tip: string;
  /** Tribes the card wants in the lobby. */
  wantsTribes?: Tribe[];
}

export interface HeroStatsBundle {
  source: 'personal' | 'community';
  label: string; // e.g. "Your games" or "Community (last patch, all ranks)"
  updatedAt: string;
  stats: HeroStat[];
  /** Game mode the stats refer to (placements are 1..4 in duos). Absent = solo. */
  mode?: GameMode;
  /** Personal bundles: tier-up timing over all heroes (fallback for heroes without their own). */
  tierCurve?: TierTimingCurve;
}

// ---------------------------------------------------------------------------
// App-level status, settings & IPC payloads
// ---------------------------------------------------------------------------

export interface GameWindowInfo {
  /** Whether the Hearthstone window was found. */
  found: boolean;
  /** Whether Hearthstone is the foreground window. */
  focused: boolean;
  minimized: boolean;
  /** Client-area bounds in screen DIP coordinates (Electron coordinates). */
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface AppStatus {
  version: string;
  platform: string;
  hearthstoneInstallPath?: string;
  logsPath?: string;
  /** Power.log currently being tailed. */
  powerLogPath?: string;
  /** log.config state. */
  logConfig: 'ok' | 'updated' | 'missing-restart-required' | 'error' | 'unknown';
  /** Whether Hearthstone is running (log activity or window found). */
  hearthstoneRunning: boolean;
  gameWindow: GameWindowInfo;
  watching: boolean;
  demo: { running: boolean; progress?: number; speed?: number };
  cardData: { build: number; patch?: string; source: string; cards: number };
  errors: string[];
  /** Diagnostics log state (main process). */
  diagnostics?: DiagnosticsStatus;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface DiagnosticsStatus {
  /** Folder with tavern-lens*.log and sim-cases.jsonl. */
  logsDir: string;
  logFile?: string;
  verbose: boolean;
  /** Errors / warnings logged since the app started. */
  errorCount: number;
  warnCount: number;
  /** The last few errors (oldest first). */
  recentErrors: { at: number; scope: string; message: string }[];
}

export interface DiagnosticsExportOptions {
  /** Include Hearthstone's own Power.log (default true). */
  includeGameLogs?: boolean;
}

export interface DiagnosticsExportResult {
  ok: boolean;
  /** The zip that was written. */
  path?: string;
  bytes?: number;
  files?: { name: string; size: number }[];
  notes?: string[];
  error?: string;
}

export type WidgetId =
  | 'heroSelection'
  | 'opponentsPanel'
  | 'battleSim'
  | 'sessionStats'
  | 'lobbyInfo'
  | 'counters'
  | 'postMatch'
  | 'trinketPick';

export interface WidgetPosition {
  /** Fraction of the game window (0..1) for the widget's top-left corner. */
  x: number;
  y: number;
}

export interface Settings {
  /** Master switch for the overlay. */
  overlayEnabled: boolean;
  widgets: Record<WidgetId, boolean>;
  /** Widget positions (draggable widgets). Missing = default. */
  positions: Partial<Record<WidgetId, WidgetPosition>>;
  /** UI scale multiplier (0.6 - 1.6). */
  scale: number;
  /** Widget background opacity (0.3 - 1). */
  opacity: number;
  /** Hide the overlay when Hearthstone is not the focused window. */
  hideWhenUnfocused: boolean;
  /** Override for the Hearthstone install directory. */
  hearthstonePath?: string;
  /** Number of simulator iterations. */
  simIterations: number;
  /** Show card images from art.hearthstonejson.com (else text-only). */
  cardImages: boolean;
  /** Fetch community hero stats. */
  communityStats: boolean;
  /** Global hotkeys (Electron accelerators). */
  hotkeys: { toggleOverlay: string; toggleOpponents: string };
  /** Launch the app on system start-up. */
  launchOnStartup: boolean;
  /** Last known rating for the session tracker (manual entry). */
  manualRating?: number;
  locale: string;
  /** Write debug-level detail to the diagnostics log. */
  verboseLogging?: boolean;
  /** "Export diagnostics": include Hearthstone's Power.log. */
  exportIncludeGameLogs?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  overlayEnabled: true,
  widgets: {
    heroSelection: true,
    opponentsPanel: true,
    battleSim: true,
    sessionStats: true,
    lobbyInfo: true,
    counters: true,
    postMatch: true,
    trinketPick: true,
  },
  positions: {},
  scale: 1,
  opacity: 0.92,
  hideWhenUnfocused: true,
  simIterations: 4000,
  cardImages: true,
  communityStats: true,
  hotkeys: {
    toggleOverlay: 'CommandOrControl+Shift+H',
    toggleOpponents: 'CommandOrControl+Shift+O',
  },
  launchOnStartup: false,
  locale: 'enUS',
  verboseLogging: false,
  exportIncludeGameLogs: true,
};
