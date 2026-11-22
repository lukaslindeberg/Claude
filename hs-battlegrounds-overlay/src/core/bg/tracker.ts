/**
 * Battlegrounds domain tracker: consumes Power.log lines and maintains a
 * `BgGameState` snapshot (shared contract) plus discrete `BgEvent`s.
 *
 * See README.md in this folder for the detection logic and log quirks.
 */
import type {
  BattleSimInput,
  BattleState,
  BgEvent,
  BgGameState,
  BoardSnapshot,
  CombatRecord,
  GameMode,
  HeroOption,
  MatchRecord,
  MinionSnapshot,
  PlayerState,
  ShopOffer,
  SimSide,
  Tribe,
  TrinketOption,
} from '@shared/types';
import { CardDb } from '../cards/cardDb';
import { CardType, GameTag as T, PlayState, Zone } from '../log/enums';
import { PowerLogParser, tagName, type Packet } from '../log/powerLogParser';
import { EntityStore, type Entity } from '../game/entityStore';
import { localCounters, type CounterRelevance } from './counters';
import {
  displayName,
  enchantmentIndex,
  lobbyTribeEvidence,
  mainTribes,
  minionSnapshot,
  shopOffer,
  tagsRecord,
} from './snapshots';

export interface BgTrackerOptions {
  cardDb?: CardDb;
  now?: () => number;
}

/** A packet whose handling threw (the tracker skipped it and carried on). */
export interface PacketErrorInfo {
  /** The log line that completed the packet (for multi-line packets: the line after it). */
  line: string;
  packetType: string;
  /** Compact JSON of the packet (truncated). */
  packet: string;
  ts: string;
}

/** Counters and timing for diagnostics. Counters are cumulative since construction. */
export interface TrackerDiagnostics {
  lines: number;
  packets: number;
  /** Lines that looked like a packet but did not parse. */
  unparsed: number;
  lastUnparsed?: string;
  /** Packets whose handling threw. */
  packetErrors: number;
  /** Log timestamp (`HH:MM:SS.fffffff`, local time) of the latest packet. */
  logTs: string;
  /** Whether the state follows the animated (PowerTaskList) playback. */
  followsPlayback: boolean;
  /** GameEntity TURN in the GameState stream / in the animated playback. */
  gsTurn: number;
  playbackTurn: number;
  /** How far (log time) the animated playback trails the GameState stream, when known. */
  playbackLagMs?: number;
}

interface PlayerTrack {
  playerId: number;
  heroEntityId: number;
  tierHistory: { tier: number; turn: number }[];
  maxTier: number;
  healthHistory: { turn: number; value: number }[];
  combatsAgainst: CombatRecord[];
  lastBoard?: BoardSnapshot;
  nameVotes: Map<string, number>;
  dead: boolean;
  diedOnTurn?: number;
}

interface TemplateGroup {
  playerId: number;
  heroId: number;
  members: number[];
}

interface CombatCtx {
  turn: number;
  /** Highest entity id when the combat started: opponent combat entities are always created after. */
  maxIdAtStart: number;
  /** Local NEXT_OPPONENT_PLAYER_ID when the combat started. */
  oppPid: number;
  /** Our side snapshot at combat start (before duos swaps). */
  localSideAtStart?: SimSide;
  localBoardAtStart: MinionSnapshot[];
  installed: boolean;
  installDepth: number;
  captured: boolean;
  input?: BattleSimInput;
  oppHeroCardId?: string;
  templates: TemplateGroup[];
  templateOpen?: TemplateGroup;
  templateDepth: number;
  /** health+armor baselines of heroes in PLAY (reset when the hero attack starts). */
  baselines: Map<number, number>;
  maxDrop: Map<number, number>;
  heroAttack?: { attackerId: number; side: 'local' | 'opp'; atk: number };
  ended: boolean;
}

/** Where the client's animated playback of the game is (from PowerTaskList lines). */
interface Playback {
  /** True once any PowerTaskList GameEntity change was seen for this game. */
  seen: boolean;
  /** GameEntity TURN as animated. */
  turn: number;
  /** GameEntity BOARD_VISUAL_STATE as animated (1 shop, 2 combat). */
  visual: number;
  /** STATE=COMPLETE animated (or the log ended). */
  complete: boolean;
}

interface GameCtx {
  playback: Playback;
  /** Sticky relevance of the Blood Gem / Beetle counters for this game. */
  counterSeen: CounterRelevance;
  /** Log timestamp at which the GameState stream reached each GameEntity TURN. */
  turnTs: Map<number, string>;
  /** Log timestamp at which the GameState stream ended the local player's game. */
  endedTs?: string;
  gameId: string;
  isBg: boolean;
  bgDecided: boolean;
  startEmitted: boolean;
  gameType: string;
  buildNumber?: number;
  scenarioId?: number;
  seed: number;
  startedAt: number;
  endedAt?: number;
  ended: boolean;
  finalPlacement?: number;
  heroOptionIds: number[];
  heroChoiceId?: number;
  /** Hero options seen in hand before the choice entry: published at the end of the batch. */
  earlyOptions?: boolean;
  lastHeroOptionsKey: string;
  chosenHeroCardId?: string;
  localHeroId?: number;
  bobIds: Set<number>;
  players: Map<number, PlayerTrack>;
  combat?: CombatCtx;
  battle: BattleState;
  battles: BattleState[];
  combats: CombatRecord[];
  tribes: Set<Tribe>;
  /** Shop actions (APM counter); turnStartTs is the log time the current shop opened. */
  apm: { turn: number; turnActions: number; turnStartTs: string; pastActions: number; pastMs: number; last?: { turn: number; actions: number; ms: number } };
  /** The lobby's tribes as read from the hero-pick screen (authoritative when set). */
  screenTribes?: Tribe[];
  /** Dummy-player names seen outside combat (Bob's skin / innkeeper names). */
  shopNames: Set<string>;
  firstCombatSeen: boolean;
  lastTurn: number;
  lastLocalBoard: MinionSnapshot[];
  matchRecord?: MatchRecord;
  damageCapEnabled?: boolean;
  /** Open trinket offer to the local player (lesser / greater trinket discover). */
  trinketChoice?: { choiceId: number; ids: number[] };
  /** Trinkets the local player picked from trinket offers, in order. */
  trinketPicks: string[];
  /** Trinkets / quest rewards seen in the local player's PLAY zone (card ids, first seen first). */
  ownedTrinkets: string[];
  ownedRewards: string[];
  /**
   * Duos: order (packet sequence) of the latest HEALTH/DAMAGE/ARMOR and PLAYER_LEADERBOARD_PLACE
   * change per hero entity. Teammates share one health pool and one place, but the client
   * updates the two leaderboard heroes one after the other: the freshest one is right.
   */
  hpSeq: Map<number, number>;
  placeSeq: Map<number, number>;
  /** Duos: PLAYER_IDs seen fighting on the same side of a combat (pid -> teammate pid). */
  pairs: Map<number, number>;
  /**
   * Duos: Player entity tags last seen while each PLAYER_ID was fighting. A teammate who
   * fights second only exists as a SETASIDE template at combat start, and the template's
   * player enchant (Bacon_TagTransferPlayerE: Tasty Lobster count, Undead bonuses, ...) is
   * hidden; its tags are transferred to the Player entity only when that player joins the
   * fight. This is the best known value for the next combat.
   */
  playerTagCache: Map<number, Map<number, number>>;
}

const EMPTY_BATTLE: BattleState = { status: 'idle', turn: 0 };
/** State enum: COMPLETE. */
const GAME_STATE_COMPLETE = 3;
/**
 * How far (log time) the animated playback may trail the GameState stream and still be
 * followed. Real logs trail by up to a combat's length (~65 s for a big final fight);
 * beyond this the client has stopped animating (left the game screen, disconnected,
 * crashed) and the GameState stream is shown instead.
 */
export const MAX_PLAYBACK_LAG_MS = 150_000;
const DAY_MS = 86_400_000;

function freshPlayback(): Playback {
  return { seen: false, turn: 0, visual: 0, complete: false };
}

/** Power.log timestamp `HH:MM:SS.fffffff` -> ms of the day (NaN if absent / malformed). */
export function logTimeMs(ts: string): number {
  if (ts.length < 8 || ts.charCodeAt(2) !== 58 || ts.charCodeAt(5) !== 58) return NaN;
  const h = +ts.slice(0, 2);
  const m = +ts.slice(3, 5);
  const sec = parseFloat(ts.slice(6));
  return (h * 3600 + m * 60 + sec) * 1000;
}

/** `later - earlier` in ms for two log timestamps, across midnight; NaN if either is missing. */
export function logTimeDiff(later: string, earlier: string): number {
  let d = logTimeMs(later) - logTimeMs(earlier);
  if (d < -DAY_MS / 2) d += DAY_MS;
  return d < 0 ? 0 : d;
}

/** Card id of the per-player "Secret Deity" objective of Aberration lobbies. */
const DEITY_OBJECTIVE = 'BG_OldGod';

/** GameEntity tags copied into every SimSide.playerTags (lobby-wide modifiers). */
const GLOBAL_GAME_TAGS = [T.BACON_GLOBAL_OLD_GOD_DBID, T.BACON_GLOBAL_ANOMALY_DBID, T.BACON_COMBAT_DAMAGE_CAP];

/** Empty trinket slots ("Lesser Trinket" / "Greater Trinket") before a trinket is picked. */
function isTrinketPlaceholder(cardId: string): boolean {
  return /_Trinket_(1st|2nd)$/.test(cardId);
}

function isPlaceholderHero(cardId: string): boolean {
  return cardId === 'TB_BaconShop_HERO_PH' || cardId === '' || cardId.startsWith('TB_BaconShop_HERO_PH');
}

export class BgTracker {
  private readonly cardDb: CardDb;
  private readonly now: () => number;
  private readonly parser = new PowerLogParser();
  private readonly store = new EntityStore();
  private g?: GameCtx;
  private prevGame?: GameCtx;
  private pendingNewGame = false;
  private depth = 0;
  /** Counter for GameCtx.hpSeq / placeSeq. */
  private tagSeq = 0;
  private events: BgEvent[] = [];
  private packets: Packet[] = [];
  private spectating = false;
  private _version = 0;
  private cache?: { version: number; state: BgGameState };
  /** Timestamp of the latest packet. */
  private logTs = '';
  /** Since when (wall clock, measured by tick()) the log has been silent at `logTs`. */
  private idle?: { ts: string; at: number };
  /** Whether the last built state followed the playback. */
  private followed = false;
  private stats = { lines: 0, packets: 0, packetErrors: 0 };
  /**
   * Called when handling a packet throws. The packet is skipped and processing goes on,
   * so one bad packet (or a tracker bug) never stops the tracking of a game.
   */
  onPacketError?: (err: unknown, info: PacketErrorInfo) => void;

  constructor(opts: BgTrackerOptions = {}) {
    this.cardDb = opts.cardDb ?? CardDb.bundled();
    this.now = opts.now ?? Date.now;
    this.store.onTagChange = (e, tag, prev, value) => this.onTagChange(e, tag, prev, value);
    this.store.onNameResolved = (id, name) => this.onName(id, name);
  }

  /** Increments on every state change. */
  get version(): number {
    return this._version;
  }

  /**
   * Forget everything (e.g. the client started a new log file). With
   * `keepUnfinishedGame`, a BG game that has not ended is remembered so that a
   * reconnect in the new log (same GAME_SEED, after a client restart) continues it.
   */
  reset(opts: { keepUnfinishedGame?: boolean } = {}): void {
    const unfinished = this.g?.isBg && !this.g.ended ? this.g : this.g ? undefined : this.prevGame;
    const keep = opts.keepUnfinishedGame ? unfinished : undefined;
    this.parser.reset();
    this.store.reset();
    this.g = undefined;
    this.prevGame = keep;
    this.pendingNewGame = false;
    this.depth = 0;
    this.events = [];
    this.spectating = false;
    this.logTs = '';
    this.idle = undefined;
    this._version++;
    this.cache = undefined;
  }

  feedLines(lines: string[]): BgEvent[] {
    const out: BgEvent[] = [];
    for (const l of lines) {
      const ev = this.feedLine(l);
      if (ev.length) out.push(...ev);
    }
    const g = this.g;
    if (g?.earlyOptions) {
      g.earlyOptions = false;
      if (g.heroChoiceId === undefined && !g.chosenHeroCardId && g.heroOptionIds.length) {
        this.events = [];
        this.emitHeroOptions(g, false);
        this._version++;
        out.push(...this.events);
      }
    }
    return out;
  }

  feedLine(line: string): BgEvent[] {
    this.stats.lines++;
    if (line.indexOf('Spectat') >= 0) this.spectatorLine(line);
    const pk = this.packets;
    pk.length = 0;
    this.parser.feedLine(line, pk);
    if (pk.length === 0) return [];
    this.events = [];
    for (let i = 0; i < pk.length; i++) this.safeHandle(pk[i], line);
    return this.events;
  }

  private safeHandle(pk: Packet, line: string): void {
    this.stats.packets++;
    try {
      this.handle(pk);
    } catch (err) {
      this.stats.packetErrors++;
      this.cache = undefined;
      this._version++;
      if (!this.onPacketError) return;
      let packet: string;
      try {
        packet = JSON.stringify(pk);
      } catch {
        packet = pk.type;
      }
      if (packet.length > 600) packet = `${packet.slice(0, 600)}…`;
      try {
        this.onPacketError(err, { line: line.length > 600 ? `${line.slice(0, 600)}…` : line, packetType: pk.type, packet, ts: pk.ts });
      } catch {
        /* the reporter must not break tracking */
      }
    }
  }

  /** Counters and playback timing for the diagnostics log. */
  diagnostics(): TrackerDiagnostics {
    const g = this.g;
    const gsTurn = this.store.tag(this.store.gameEntityId, T.TURN);
    const out: TrackerDiagnostics = {
      lines: this.stats.lines,
      packets: this.stats.packets,
      unparsed: this.parser.unparsed,
      packetErrors: this.stats.packetErrors,
      logTs: this.logTs,
      followsPlayback: false,
      gsTurn,
      playbackTurn: g?.playback.turn ?? 0,
    };
    if (this.parser.lastUnparsed) out.lastUnparsed = this.parser.lastUnparsed;
    if (!g?.isBg) return out;
    out.followsPlayback = this.followsPlayback(g);
    const pb = g.playback;
    if (pb.seen && pb.turn > 0 && pb.turn <= gsTurn) {
      let since: string | undefined;
      for (let t = pb.turn + 1; t <= gsTurn && since === undefined; t++) since = g.turnTs.get(t);
      if (since === undefined && g.ended && !pb.complete) since = g.endedTs;
      if (since === undefined) out.playbackLagMs = 0;
      else {
        const lag = logTimeDiff(this.logTs, since);
        if (!Number.isNaN(lag)) out.playbackLagMs = lag;
      }
    }
    return out;
  }

  /**
   * Emit any buffered multi-line packet and, if the local player's game is over but the
   * log ended before STATE=COMPLETE, the pending gameEnd. Call at end of input.
   */
  flush(): BgEvent[] {
    const pk: Packet[] = [];
    this.parser.flush(pk);
    this.events = [];
    for (const p of pk) this.safeHandle(p, '(end of log)');
    const g = this.g;
    if (g && g.isBg && g.ended && !g.matchRecord) this.finishGame(g);
    if (g && g.ended && g.playback.seen && !g.playback.complete) {
      // The log ended: nothing more will be animated.
      g.playback.complete = true;
      this.bump();
    }
    return this.events;
  }

  /**
   * Call every few seconds. While the log is silent, time still passes for a playback
   * that has stopped (the client left the game screen): this re-checks whether it should
   * still be followed. Returns true if the state changed.
   */
  tick(): boolean {
    const g = this.g;
    if (!g?.isBg) return false;
    if (!this.idle || this.idle.ts !== this.logTs) this.idle = { ts: this.logTs, at: this.now() };
    if (!this.cache || this.followsPlayback(g) === this.followed) return false;
    this.bump();
    return true;
  }

  private spectatorLine(line: string): void {
    if (/Begin Spectating|Start Spectator/.test(line)) this.spectating = true;
    else if (/End Spectator/.test(line)) this.spectating = false;
    else return;
    this.bump();
  }

  private bump(): void {
    this._version++;
  }

  private emit(e: BgEvent): void {
    this.events.push(e);
  }

  // -------------------------------------------------------------------------
  // Packet handling
  // -------------------------------------------------------------------------

  private handle(pk: Packet): void {
    const s = this.store;
    if (pk.ts) this.logTs = pk.ts;
    switch (pk.type) {
      case 'CreateGame': {
        if (this.g && this.g.isBg && this.g.ended && !this.g.matchRecord) this.finishGame(this.g);
        if (this.g && this.g.isBg && !this.g.ended) this.prevGame = this.g;
        else if (this.g) this.prevGame = undefined;
        // (no current game: keep a game remembered by reset({ keepUnfinishedGame }))
        if (this.g?.isBg) this.bump();
        this.g = undefined;
        this.depth = 0;
        this.pendingNewGame = true;
        s.apply(pk);
        return;
      }
      case 'GameEntity': {
        s.apply(pk);
        if (this.pendingNewGame) this.startGame();
        return;
      }
      case 'BlockStart': {
        try {
          s.apply(pk);
          const g = this.g;
          if (g?.isBg) this.onBlockStart(g, pk);
        } finally {
          // Even if handling threw: BLOCK_END will decrement it.
          this.depth++;
        }
        return;
      }
      case 'Playback': {
        const g = this.g;
        if (!g) return;
        if (pk.reset) {
          // New game or reconnect: values printed before belong to the previous connection.
          g.playback = freshPlayback();
          if (g.isBg) this.bump();
          return;
        }
        const pb = g.playback;
        pb.seen = true;
        if (pk.tag === T.TURN) pb.turn = pk.value;
        else if (pk.tag === T.BOARD_VISUAL_STATE) pb.visual = pk.value;
        else if (pk.tag === T.STATE && pk.value === GAME_STATE_COMPLETE) pb.complete = true;
        if (g.isBg) this.bump();
        return;
      }
      case 'BlockEnd': {
        this.depth--;
        const g = this.g;
        if (g?.isBg && g.combat && !g.ended) {
          const c = g.combat;
          if (c.installed && !c.captured && this.depth < c.installDepth) this.captureCombat(g);
          if (c.templateOpen && this.depth < c.templateDepth) c.templateOpen = undefined;
        }
        return;
      }
      default:
        break;
    }

    const g = this.g;
    if (!g) {
      s.apply(pk);
      return;
    }

    switch (pk.type) {
      case 'Player': {
        s.apply(pk);
        const dummyHero = s.tag(pk.id, T.HERO_ENTITY);
        if (s.isDummy(pk.id) && dummyHero) g.bobIds.add(dummyHero);
        break;
      }
      case 'GameInfo': {
        s.apply(pk);
        if (pk.key === 'GameType') {
          g.gameType = pk.value;
          if (!g.bgDecided || !g.isBg) {
            g.isBg = /BATTLEGROUNDS/.test(pk.value);
            g.bgDecided = true;
          }
        } else if (pk.key === 'BuildNumber') g.buildNumber = parseInt(pk.value, 10) || undefined;
        else if (pk.key === 'ScenarioID') g.scenarioId = parseInt(pk.value, 10) || undefined;
        this.maybeEmitStart(g);
        break;
      }
      case 'FullEntity': {
        this.decideBgFromEntities(g);
        const e = s.apply(pk)!;
        if (g.isBg) this.onFullEntity(g, e);
        break;
      }
      case 'EntityChoices': {
        s.apply(pk);
        this.decideBgFromEntities(g);
        if (g.isBg) this.onChoices(g, pk);
        break;
      }
      case 'EntitiesChosen': {
        s.apply(pk);
        if (g.isBg) this.onChosen(g, pk);
        break;
      }
      case 'ShowEntity':
      case 'ChangeEntity': {
        this.decideBgFromEntities(g);
        const e = s.apply(pk);
        if (g.isBg && e) {
          if (g.heroOptionIds.includes(e.id) && !g.chosenHeroCardId) this.emitHeroOptions(g, false);
          this.inferTribe(g, e);
        }
        break;
      }
      default:
        this.decideBgFromEntities(g);
        s.apply(pk);
        break;
    }
    if (g.isBg) this.bump();
  }

  private startGame(): void {
    this.pendingNewGame = false;
    const s = this.store;
    const seed = s.tag(s.gameEntityId, T.GAME_SEED);
    const prev = this.prevGame;
    this.prevGame = undefined;
    if (prev && seed && prev.seed === seed) {
      // Reconnect: same game, continue history. Playback restarts with the new connection.
      this.g = prev;
      prev.combat = undefined;
      prev.playback = freshPlayback();
      // New entity ids: the freshness order restarts.
      prev.hpSeq.clear();
      prev.placeSeq.clear();
      this.bump();
      return;
    }
    const startedAt = this.now();
    this.g = {
      playback: freshPlayback(),
      counterSeen: { bloodGem: false, beetle: false },
      turnTs: new Map(),
      gameId: `bg-${seed || 0}-${startedAt}`,
      isBg: false,
      bgDecided: false,
      startEmitted: false,
      gameType: '',
      seed,
      startedAt,
      ended: false,
      heroOptionIds: [],
      lastHeroOptionsKey: '',
      bobIds: new Set(),
      players: new Map(),
      battle: { ...EMPTY_BATTLE },
      battles: [],
      combats: [],
      tribes: new Set(),
      apm: { turn: 0, turnActions: 0, turnStartTs: '', pastActions: 0, pastMs: 0 },
      shopNames: new Set(),
      firstCombatSeen: false,
      lastTurn: 0,
      lastLocalBoard: [],
      trinketPicks: [],
      ownedTrinkets: [],
      ownedRewards: [],
      hpSeq: new Map(),
      placeSeq: new Map(),
      pairs: new Map(),
      playerTagCache: new Map(),
    };
  }

  /** Before DebugPrintGame (or when it's missing) decide BG-ness from the entities. */
  private decideBgFromEntities(g: GameCtx): void {
    if (g.bgDecided) {
      if (g.isBg && !g.startEmitted) this.maybeEmitStart(g);
      return;
    }
    const s = this.store;
    if (s.players.size === 0) return;
    const scen = s.tag(s.gameEntityId, 937);
    const bg = !!s.dummyPlayer || scen === 3459 || scen === 5173;
    g.isBg = bg;
    g.bgDecided = true;
    if (!g.gameType && bg) g.gameType = this.isDuosByTags() ? 'GT_BATTLEGROUNDS_DUO' : 'GT_BATTLEGROUNDS';
    this.maybeEmitStart(g);
  }

  private isDuosByTags(): boolean {
    const s = this.store;
    const lp = s.localPlayer;
    return (lp ? s.tag(lp.entityId, T.BACON_DUO_TEAMMATE_PLAYER_ID) > 0 : false) || s.tag(s.gameEntityId, 937) === 5173;
  }

  private mode(g: GameCtx): GameMode {
    return /DUO/.test(g.gameType) || this.isDuosByTags() ? 'duos' : 'solo';
  }

  private maybeEmitStart(g: GameCtx): void {
    if (g.startEmitted || !g.isBg || this.store.players.size === 0) return;
    g.startEmitted = true;
    this.bump();
    this.emit({ type: 'gameStart', gameId: g.gameId, mode: this.mode(g), gameType: g.gameType, spectating: this.spectating });
  }

  // -------------------------------------------------------------------------
  // Helpers over the store
  // -------------------------------------------------------------------------

  private get localController(): number {
    return this.store.localPlayer?.playerId ?? -1;
  }
  private get dummyController(): number {
    return this.store.dummyPlayer?.playerId ?? -2;
  }

  private bgTurn(): number {
    const t = this.store.tag(this.store.gameEntityId, T.TURN);
    return t > 0 ? Math.ceil(t / 2) : 0;
  }

  /** PLAYER_ID (lobby slot) of the local player. */
  private localPid(g: GameCtx): number {
    const s = this.store;
    const h = g.localHeroId !== undefined ? s.tag(g.localHeroId, T.PLAYER_ID) : 0;
    if (h > 0) return h;
    const lp = s.localPlayer;
    return lp ? s.tag(lp.entityId, T.PLAYER_ID) || lp.playerId : 0;
  }

  private teammatePid(): number {
    const lp = this.store.localPlayer;
    return lp ? this.store.tag(lp.entityId, T.BACON_DUO_TEAMMATE_PLAYER_ID) : 0;
  }

  /** BACON_DUO_TEAM_ID of a leaderboard hero (the local one may only have it on the Player entity). */
  private teamIdOf(g: GameCtx, pid: number, e: Entity): number {
    const team = e.tags.get(T.BACON_DUO_TEAM_ID) ?? 0;
    if (team) return team;
    const lp = this.store.localPlayer;
    return lp && pid === this.localPid(g) ? this.store.tag(lp.entityId, T.BACON_DUO_TEAM_ID) : 0;
  }

  /**
   * Duos: PLAYER_ID -> teammate's PLAYER_ID, from BACON_DUO_TEAM_ID, our
   * BACON_DUO_TEAMMATE_PLAYER_ID, NEXT_OPPONENT(_TEAMMATE)_PLAYER_ID and the sides of the
   * combats seen so far.
   */
  private partners(g: GameCtx, heroes: Map<number, Entity>): Map<number, number> {
    const out = new Map<number, number>();
    const link = (a: number, b: number) => {
      if (a > 0 && b > 0 && a !== b && !out.has(a) && !out.has(b)) {
        out.set(a, b);
        out.set(b, a);
      }
    };
    const s = this.store;
    const lp = s.localPlayer;
    link(this.localPid(g), this.teammatePid());
    const byTeam = new Map<number, number[]>();
    for (const [pid, e] of heroes) {
      const team = this.teamIdOf(g, pid, e);
      if (!team) continue;
      const l = byTeam.get(team) ?? [];
      l.push(pid);
      byTeam.set(team, l);
    }
    for (const l of byTeam.values()) if (l.length === 2) link(l[0], l[1]);
    if (lp) link(s.tag(lp.entityId, T.NEXT_OPPONENT_PLAYER_ID), s.tag(lp.entityId, T.NEXT_OPPONENT_TEAMMATE_PLAYER_ID));
    for (const [a, b] of g.pairs) link(a, b);
    return out;
  }

  /** Of a player's and their teammate's leaderboard heroes, the one changed last in `seq`. */
  private freshestOf(heroes: Map<number, Entity>, pid: number, mate: number | undefined, seq: Map<number, number>): Entity | undefined {
    const a = heroes.get(pid);
    const b = mate ? heroes.get(mate) : undefined;
    if (!a || !b) return a ?? b;
    return (seq.get(b.id) ?? 0) > (seq.get(a.id) ?? 0) ? b : a;
  }

  /** health+armor of a player; in duos the team's shared pool (freshest teammate hero). */
  private sharedHp(g: GameCtx, pid: number, heroes: Map<number, Entity>, partners?: Map<number, number>): number {
    const e = this.freshestOf(heroes, pid, partners?.get(pid), g.hpSeq);
    return e ? this.heroHp(e) : 0;
  }

  /** Is `e` the local player's real hero (not a placeholder / duos teammate copy)? */
  private isRealLocalHero(e: Entity | undefined, g: GameCtx): boolean {
    if (!e || e.tags.get(T.CARDTYPE) !== CardType.HERO || isPlaceholderHero(e.cardId)) return false;
    if (e.tags.get(T.CONTROLLER) !== this.localController) return false;
    if (e.tags.get(T.COPIED_FROM_ENTITY_ID)) return false;
    const pid = e.tags.get(T.PLAYER_ID) ?? 0;
    const lp = this.store.localPlayer;
    if (pid > 0 && lp && pid !== (this.store.tag(lp.entityId, T.PLAYER_ID) || lp.playerId)) return false;
    void g;
    return true;
  }

  private refreshLocalHero(g: GameCtx): void {
    const lp = this.store.localPlayer;
    if (!lp) return;
    const h = this.store.get(this.store.tag(lp.entityId, T.HERO_ENTITY));
    if (this.isRealLocalHero(h, g)) {
      if (g.localHeroId !== h!.id) {
        g.localHeroId = h!.id;
        if (!g.chosenHeroCardId) {
          g.chosenHeroCardId = h!.cardId;
          this.emit({ type: 'heroChosen', cardId: h!.cardId });
        }
      }
    }
  }

  /** Leaderboard hero entities by PLAYER_ID. */
  private leaderboardHeroes(g: GameCtx): Map<number, Entity> {
    const s = this.store;
    const out = new Map<number, Entity>();
    const dummy = this.dummyController;
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CARDTYPE) !== CardType.HERO) continue;
      const pid = e.tags.get(T.PLAYER_ID) ?? 0;
      if (pid <= 0) continue;
      if (e.tags.get(T.CONTROLLER) !== dummy) continue;
      if (e.tags.get(T.ZONE) !== Zone.SETASIDE) continue;
      if (isPlaceholderHero(e.cardId)) continue;
      const cur = out.get(pid);
      // Prefer the registered one; else the newest.
      const reg = g.players.get(pid)?.heroEntityId;
      if (!cur || e.id === reg || (cur.id !== reg && e.id > cur.id)) out.set(pid, e);
    }
    const lh = s.get(g.localHeroId);
    if (lh) {
      const pid = this.localPid(g);
      if (pid > 0) out.set(pid, lh);
    }
    return out;
  }

  private track(g: GameCtx, pid: number, heroId: number): PlayerTrack {
    let t = g.players.get(pid);
    if (!t) {
      t = { playerId: pid, heroEntityId: heroId, tierHistory: [], maxTier: 1, healthHistory: [], combatsAgainst: [], nameVotes: new Map(), dead: false };
      g.players.set(pid, t);
    } else t.heroEntityId = heroId;
    return t;
  }

  private syncPlayers(g: GameCtx): Map<number, Entity> {
    const heroes = this.leaderboardHeroes(g);
    for (const [pid, e] of heroes) this.track(g, pid, e.id);
    return heroes;
  }

  private heroHp(e: Entity): number {
    return (e.tags.get(T.HEALTH) ?? 0) - (e.tags.get(T.DAMAGE) ?? 0) + (e.tags.get(T.ARMOR) ?? 0);
  }

  // -------------------------------------------------------------------------
  // Tag changes
  // -------------------------------------------------------------------------

  private onTagChange(e: Entity, tag: number, prev: number, value: number): void {
    const g = this.g;
    if (!g || !g.isBg) return;
    const s = this.store;
    // The game shuffles the offered heroes in hand: republish early options in screen order.
    if (tag === T.ZONE_POSITION && g.heroChoiceId === undefined && g.heroOptionIds.includes(e.id)) g.earlyOptions = true;
    if (e.id === s.gameEntityId) {
      if (tag === T.STATE && value === 3) {
        this.finishGame(g);
        return;
      }
      if (tag === T.TURN && !g.turnTs.has(value)) g.turnTs.set(value, this.logTs);
      // After our game ended the server keeps simulating (victory laps, ghost combats): ignore.
      if (g.ended) return;
      if (tag === T.TURN) this.onTurn(g, value);
      else if (tag === T.BOARD_VISUAL_STATE) {
        if (value === 2) this.startCombat(g);
        else if (value === 1 && g.combat && !g.combat.ended) this.endCombat(g);
      } else if (tag === T.BACON_COMBAT_DAMAGE_CAP_ENABLED) g.damageCapEnabled = value > 0;
      return;
    }
    const player = s.players.get(e.id);
    if (player) {
      const isLocal = s.localPlayer?.entityId === e.id;
      if (tag === T.HERO_ENTITY) {
        if (isLocal) this.refreshLocalHero(g);
        else if (s.isDummy(e.id)) this.onDummyHero(g, value);
      } else if (tag === T.PLAYSTATE && isLocal) {
        if (value === PlayState.WON || value === PlayState.LOST || value === PlayState.TIED) this.endGame(g);
      }
      return;
    }
    const ct = e.tags.get(T.CARDTYPE);
    if (ct === CardType.HERO) {
      if (tag === T.HEALTH || tag === T.DAMAGE || tag === T.ARMOR) g.hpSeq.set(e.id, ++this.tagSeq);
      else if (tag === T.PLAYER_LEADERBOARD_PLACE) g.placeSeq.set(e.id, ++this.tagSeq);
      if (g.combat && !g.combat.ended && (tag === T.DAMAGE || tag === T.ARMOR)) this.onCombatHeroHp(g, e, tag, prev, value);
      if (tag === T.PLAYER_TECH_LEVEL || tag === T.DAMAGE || tag === T.HEALTH) this.onLeaderboardTag(g, e, tag, value);
      if (tag === T.ZONE && e.id === g.localHeroId) {
        // local hero moved (duos swaps): nothing to do, stays the local hero.
      }
    }
  }

  private onLeaderboardTag(g: GameCtx, e: Entity, tag: number, value: number): void {
    const pid = e.tags.get(T.PLAYER_ID) ?? 0;
    const isLocal = e.id === g.localHeroId;
    if (!isLocal) {
      if (pid <= 0 || e.tags.get(T.CONTROLLER) !== this.dummyController || e.tags.get(T.ZONE) !== Zone.SETASIDE) return;
    }
    const realPid = isLocal ? this.localPid(g) : pid;
    if (realPid <= 0) return;
    const t = this.track(g, realPid, e.id);
    const turn = Math.max(1, this.bgTurn());
    if (tag === T.PLAYER_TECH_LEVEL) {
      if (value > t.maxTier) {
        t.maxTier = value;
        t.tierHistory.push({ tier: value, turn });
      }
    } else if (!t.dead && (e.tags.get(T.HEALTH) ?? 0) > 0 && (e.tags.get(T.HEALTH) ?? 0) - (e.tags.get(T.DAMAGE) ?? 0) <= 0) {
      t.dead = true;
      t.diedOnTurn = turn;
      this.emit({ type: 'playerDied', playerId: realPid, turn });
    }
  }

  private onTurn(g: GameCtx, value: number): void {
    const turn = Math.ceil(value / 2);
    if (value % 2 === 1) {
      if (g.combat && !g.combat.ended) this.endCombat(g);
      if (turn !== g.lastTurn) {
        g.lastTurn = turn;
        g.apm.turn = turn;
        g.apm.turnActions = 0;
        g.apm.turnStartTs = this.logTs;
        this.emit({ type: 'turnStart', turn });
      }
    } else if (!g.combat || g.combat.ended || g.combat.turn !== turn) {
      this.startCombat(g);
    }
  }

  // -------------------------------------------------------------------------
  // Hero selection
  // -------------------------------------------------------------------------

  private onChoices(g: GameCtx, pk: Extract<Packet, { type: 'EntityChoices' }>): void {
    const s = this.store;
    const pl = s.resolve(pk.player, 'local');
    if (pl !== undefined && s.localPlayer && pl !== s.localPlayer.entityId) return;
    if (pk.choiceType !== 1 /* MULLIGAN */) {
      this.onTrinketChoices(g, pk);
      return;
    }
    const ids: number[] = [];
    for (const r of pk.entities) {
      if (r.id === undefined) continue;
      ids.push(r.id);
      const e = s.get(r.id);
      if (e && !e.cardId && r.cardId) e.cardId = r.cardId;
    }
    if (!ids.length) return;
    g.heroOptionIds = ids;
    g.heroChoiceId = pk.choiceId;
    g.earlyOptions = false;
    this.emitHeroOptions(g, true);
  }

  /**
   * The offered heroes are created in the local player's hand when the game starts; the
   * "choose a hero" choice entry can follow seconds later. Show them as soon as they exist.
   */
  private earlyHeroOption(g: GameCtx, e: Entity): void {
    if (g.heroChoiceId !== undefined || g.chosenHeroCardId || !e.cardId) return;
    if (e.tags.get(T.CARDTYPE) !== CardType.HERO || e.tags.get(T.ZONE) !== Zone.HAND) return;
    const ctl = this.localController;
    if (ctl <= 0 || e.tags.get(T.CONTROLLER) !== ctl || g.heroOptionIds.includes(e.id)) return;
    g.heroOptionIds = [...g.heroOptionIds, e.id];
    g.earlyOptions = true;
  }

  private heroOptions(g: GameCtx): HeroOption[] {
    const s = this.store;
    const db = this.cardDb;
    // Before the choice entry: order by hand position (left to right on screen), as the choice lists them.
    const pos = (id: number) => s.tag(id, T.ZONE_POSITION) || 99;
    const ids = g.heroChoiceId === undefined ? [...g.heroOptionIds].sort((a, b) => pos(a) - pos(b)) : g.heroOptionIds;
    return ids.map((id) => {
      const e = s.get(id);
      const cardId = e?.cardId ?? '';
      const card = db.get(cardId);
      const base = db.baseHeroId(cardId);
      const hpDbf = e?.tags.get(T.HERO_POWER);
      const hp = db.getByDbfId(hpDbf)?.id ?? card?.heroPowerId ?? db.get(base)?.heroPowerId;
      const opt: HeroOption = { entityId: id, cardId, name: e ? displayName(e, db) : cardId, baseCardId: base };
      if (hp) opt.heroPowerCardId = hp;
      const armor = e?.tags.get(T.ARMOR) ?? card?.armor;
      if (armor !== undefined) opt.armor = armor;
      return opt;
    });
  }

  private emitHeroOptions(g: GameCtx, force: boolean): void {
    const opts = this.heroOptions(g);
    const key = opts.map((o) => o.cardId).join(',');
    if (!force && key === g.lastHeroOptionsKey) return;
    g.lastHeroOptionsKey = key;
    this.emit({ type: 'heroOptions', options: opts });
  }

  /**
   * Trinket offers: a GENERAL choice whose source is the "Lesser Trinket" / "Greater Trinket"
   * slot (BG30_Trinket_1st / _2nd) and whose options are BATTLEGROUND_TRINKET entities in
   * SETASIDE. Any other choice (discovers, triple rewards...) closes a stale offer.
   */
  private onTrinketChoices(g: GameCtx, pk: Extract<Packet, { type: 'EntityChoices' }>): void {
    const s = this.store;
    const ids: number[] = [];
    let allTrinkets = pk.entities.length > 0;
    for (const r of pk.entities) {
      const id = r.id ?? s.resolve(r);
      const e = s.get(id);
      if (id === undefined || !e) {
        allTrinkets = false;
        continue;
      }
      if (!e.cardId && r.cardId) e.cardId = r.cardId;
      const isTrinket =
        e.tags.get(T.CARDTYPE) === CardType.BATTLEGROUND_TRINKET || this.cardDb.get(e.cardId)?.type === 'TRINKET';
      if (!isTrinket) allTrinkets = false;
      ids.push(id);
    }
    const src = s.get(s.resolve(pk.source));
    const fromSlot = !!src && isTrinketPlaceholder(src.cardId);
    if (ids.length && (allTrinkets || fromSlot)) g.trinketChoice = { choiceId: pk.choiceId, ids };
    else g.trinketChoice = undefined;
  }

  private onChosen(g: GameCtx, pk: Extract<Packet, { type: 'EntitiesChosen' }>): void {
    const tc = g.trinketChoice;
    if (tc && pk.choiceId === tc.choiceId) {
      g.trinketChoice = undefined;
      const r = pk.entities[0];
      const id = r?.id ?? (r ? this.store.resolve(r) : undefined);
      const cardId = this.store.get(id)?.cardId || r?.cardId;
      if (cardId && !g.trinketPicks.includes(cardId)) g.trinketPicks.push(cardId);
      return;
    }
    if (g.heroChoiceId === undefined || pk.choiceId !== g.heroChoiceId || g.chosenHeroCardId) return;
    const r = pk.entities[0];
    if (!r || r.id === undefined) return;
    const e = this.store.get(r.id);
    const cardId = e?.cardId || r.cardId;
    if (!cardId) return;
    g.chosenHeroCardId = cardId;
    this.emit({ type: 'heroChosen', cardId });
  }

  /** The open trinket offer, while its options are still waiting in SETASIDE. */
  private trinketOptions(g: GameCtx): TrinketOption[] | undefined {
    const tc = g.trinketChoice;
    if (!tc || g.ended) return undefined;
    const s = this.store;
    const db = this.cardDb;
    const out: TrinketOption[] = [];
    for (const id of tc.ids) {
      const e = s.get(id);
      // Resolved without an EntitiesChosen line (e.g. timed out): the options leave SETASIDE.
      if (!e || e.tags.get(T.ZONE) !== Zone.SETASIDE) return undefined;
      const o: TrinketOption = { entityId: id, cardId: e.cardId, name: displayName(e, db) };
      // No COST tag = free (e.g. Bob-blehead).
      o.cost = e.tags.get(T.COST) ?? db.get(e.cardId)?.cost ?? 0;
      out.push(o);
    }
    return out.length ? out : undefined;
  }

  /** Remember the trinkets / quest rewards the local player has in PLAY (for the match record). */
  private noteOwnedItems(g: GameCtx): void {
    const s = this.store;
    const lctl = this.localController;
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CONTROLLER) !== lctl || e.tags.get(T.ZONE) !== Zone.PLAY || !e.cardId) continue;
      const ct = e.tags.get(T.CARDTYPE);
      if (ct === CardType.BATTLEGROUND_TRINKET) {
        if (!isTrinketPlaceholder(e.cardId) && !g.ownedTrinkets.includes(e.cardId)) g.ownedTrinkets.push(e.cardId);
      } else if (ct === CardType.BATTLEGROUND_QUEST_REWARD) {
        if (!g.ownedRewards.includes(e.cardId)) g.ownedRewards.push(e.cardId);
      }
    }
  }

  /**
   * The local player's trinket picks: from the trinket offers seen, completed from the hero's
   * BACON_FIRST/SECOND_TRINKET_DATABASE_ID (e.g. when the log started after a pick), else
   * the trinkets seen in PLAY.
   */
  private pickedTrinkets(g: GameCtx): string[] {
    const out = g.trinketPicks.slice();
    if (out.length < 2) {
      const hero = this.store.get(g.localHeroId);
      for (const tag of [T.BACON_FIRST_TRINKET_DATABASE_ID, T.BACON_SECOND_TRINKET_DATABASE_ID]) {
        const id = this.cardDb.getByDbfId(hero?.tags.get(tag))?.id;
        if (id && out.length < 2 && !out.includes(id)) out.push(id);
      }
    }
    return out.length ? out : g.ownedTrinkets.slice();
  }

  // -------------------------------------------------------------------------
  // Entities / blocks
  // -------------------------------------------------------------------------

  /** Shop offers (dummy-controlled minions in PLAY outside combat) prove which tribes are in the lobby. */
  private inferTribe(g: GameCtx, e: Entity): void {
    if (e.tags.get(T.CARDTYPE) !== CardType.MINION) return;
    if (e.tags.get(T.ZONE) !== Zone.PLAY || e.tags.get(T.CONTROLLER) !== this.dummyController) return;
    if (g.combat && !g.combat.ended) return;
    const turn = this.store.tag(this.store.gameEntityId, T.TURN);
    if (turn <= 0 || turn % 2 === 0) return;
    const t = lobbyTribeEvidence(e, this.cardDb);
    if (t && !g.tribes.has(t)) g.tribes.add(t);
  }

  private onFullEntity(g: GameCtx, e: Entity): void {
    this.inferTribe(g, e);
    this.earlyHeroOption(g, e);
    const lp = this.store.localPlayer;
    if (lp && e.id === this.store.tag(lp.entityId, T.HERO_ENTITY)) this.refreshLocalHero(g);
    const c = g.combat;
    if (!c || c.ended || c.installed) return;
    // Duos: SETASIDE templates of the other combatants' boards, controlled by the local player.
    const ct = e.tags.get(T.CARDTYPE);
    if (
      ct === CardType.HERO &&
      (e.tags.get(T.PLAYER_ID) ?? 0) > 0 &&
      e.tags.get(T.ZONE) === Zone.SETASIDE &&
      e.tags.get(T.CONTROLLER) === this.localController &&
      e.id !== g.localHeroId
    ) {
      const grp: TemplateGroup = { playerId: e.tags.get(T.PLAYER_ID)!, heroId: e.id, members: [] };
      c.templates.push(grp);
      c.templateOpen = grp;
      c.templateDepth = this.depth;
      return;
    }
    if (c.templateOpen) c.templateOpen.members.push(e.id);
  }

  private onBlockStart(g: GameCtx, pk: Extract<Packet, { type: 'BlockStart' }>): void {
    // APM: every top-level PLAY (buy, sell, play, refresh, freeze, level up...) or POWER
    // (Hero Power) by the local player while the shop is open.
    if (this.depth === 0 && g.apm.turnStartTs && (pk.blockType === 7 || pk.blockType === 3)) {
      const src = this.store.get(this.store.resolve(pk.entity));
      if (src && src.tags.get(T.CONTROLLER) === this.localController) {
        g.apm.turnActions++;
        this.bump();
      }
    }
    const c = g.combat;
    if (!c || c.ended || g.ended) return;
    const s = this.store;
    if (pk.blockType === 1 /* ATTACK */) {
      if (!c.installed && this.store.tag(this.store.gameEntityId, T.BOARD_VISUAL_STATE) === 2) {
        c.installed = true;
        c.installDepth = this.depth;
      }
      if (c.installed && !c.captured) this.captureCombat(g);
      if (c.captured && this.mode(g) === 'duos') this.cacheFighterTags(g);
      const id = s.resolve(pk.entity);
      const e = s.get(id);
      if (e && e.tags.get(T.CARDTYPE) === CardType.HERO && e.tags.get(T.ZONE) === Zone.PLAY && c.captured) {
        const side = this.attackerSide(g, e.id, e.tags.get(T.CONTROLLER));
        c.heroAttack = { attackerId: e.id, side, atk: e.tags.get(T.ATK) ?? 0 };
        // Measure damage from here on.
        c.baselines.clear();
        c.maxDrop.clear();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  private startCombat(g: GameCtx): void {
    const a = g.apm;
    if (a.turnStartTs) {
      const ms = logTimeDiff(this.logTs, a.turnStartTs);
      a.pastActions += a.turnActions;
      a.pastMs += ms;
      a.last = { turn: a.turn, actions: a.turnActions, ms };
      a.turnStartTs = '';
    }
    if (g.combat && !g.combat.ended) {
      if (g.combat.turn === this.bgTurn()) return; // already started (TURN then BOARD_VISUAL_STATE)
      this.endCombat(g);
    }
    const s = this.store;
    this.refreshLocalHero(g);
    this.syncPlayers(g);
    this.noteOwnedItems(g);
    g.trinketChoice = undefined;
    const lp = s.localPlayer;
    const oppPid = lp ? s.tag(lp.entityId, T.NEXT_OPPONENT_PLAYER_ID) || s.tag(g.localHeroId, T.NEXT_OPPONENT_PLAYER_ID) : 0;
    const localSide = this.buildLiveSide(g, 'local', this.localPid(g));
    let maxId = 0;
    for (const id of s.entities.keys()) if (id > maxId) maxId = id;
    g.combat = {
      turn: this.bgTurn(),
      maxIdAtStart: maxId,
      oppPid,
      localSideAtStart: localSide,
      localBoardAtStart: localSide?.minions ?? [],
      installed: false,
      installDepth: 0,
      captured: false,
      templates: [],
      templateDepth: 0,
      baselines: new Map(),
      maxDrop: new Map(),
      ended: false,
    };
    g.firstCombatSeen = true;
    if (localSide) g.lastLocalBoard = localSide.minions;
  }

  private onDummyHero(g: GameCtx, heroId: number): void {
    const e = this.store.get(heroId);
    if (!e) return;
    const isBob = g.bobIds.has(heroId) || e.cardId.startsWith('TB_BaconShopBob') || (e.tags.get(T.BACON_BOB_SKIN) ?? 0) > 0;
    if (isBob) {
      g.bobIds.add(heroId);
      return;
    }
    const c = g.combat;
    if (!c || c.ended || g.ended) return;
    if (!c.installed) {
      c.installed = true;
      c.installDepth = this.depth;
      c.oppHeroCardId = e.cardId;
    }
  }

  private onCombatHeroHp(g: GameCtx, e: Entity, tag: number, prev: number, value: number): void {
    const c = g.combat!;
    if (!c.captured) return;
    if (e.tags.get(T.ZONE) !== Zone.PLAY) return;
    const now = this.heroHp(e);
    if (!c.baselines.has(e.id)) {
      // value before this change
      const before = tag === T.DAMAGE ? now + (value - prev) : now - (value - prev);
      c.baselines.set(e.id, before);
    }
    const drop = c.baselines.get(e.id)! - now;
    if (drop > (c.maxDrop.get(e.id) ?? 0)) c.maxDrop.set(e.id, drop);
  }

  /** Side of a hero that attacks at the end of combat (Duos: our teammate's hero is ours). */
  private attackerSide(g: GameCtx, heroId: number, controller: number | undefined): 'local' | 'opp' {
    if (controller === this.localController) return 'local';
    if (controller === this.dummyController) return 'opp';
    if (this.mode(g) === 'duos') {
      const tm = this.teammatePid();
      const pid = this.store.tag(heroId, T.PLAYER_ID);
      if (pid && (pid === tm || pid === this.localPid(g))) return 'local';
      const card = this.store.get(heroId)?.cardId;
      const tmHero = tm ? this.leaderboardHeroes(g).get(tm) : undefined;
      if (card && tmHero?.cardId === card) return 'local';
    }
    return 'opp';
  }

  private sideOfHero(id: number): 'local' | 'opp' | undefined {
    const ctl = this.store.tag(id, T.CONTROLLER);
    if (ctl === this.localController) return 'local';
    if (ctl === this.dummyController) return 'opp';
    return undefined;
  }

  private captureCombat(g: GameCtx): void {
    const c = g.combat!;
    if (c.captured) return;
    c.captured = true;
    const s = this.store;
    const lp = s.localPlayer;
    const dp = s.dummyPlayer;
    const localPid = this.localPid(g);
    const mode = this.mode(g);

    const ourCurrent = lp ? s.tag(lp.entityId, T.BACON_CURRENT_COMBAT_PLAYER_ID) : 0;
    const liveOppHero = dp ? s.get(s.tag(dp.entityId, T.HERO_ENTITY)) : undefined;
    let liveOppPid = (dp ? s.tag(dp.entityId, T.BACON_CURRENT_COMBAT_PLAYER_ID) : 0) || (liveOppHero?.tags.get(T.PLAYER_ID) ?? 0);
    if (!liveOppPid) liveOppPid = this.pidByHeroCard(g, liveOppHero?.cardId) || c.oppPid;

    const liveLocal = this.buildLiveSide(g, 'local', ourCurrent > 0 ? ourCurrent : localPid);
    const opp = this.buildLiveSide(g, 'opp', liveOppPid);
    if (!liveLocal || !opp) {
      c.captured = false;
      return;
    }
    let player: SimSide = liveLocal;
    if (mode === 'duos') {
      const tmPid = this.teammatePid();
      if (ourCurrent > 0 && ourCurrent !== localPid && c.localSideAtStart) {
        // Teammate fights first: our board joins later.
        const { teammate: _t, ...ours } = c.localSideAtStart;
        void _t;
        player = { ...liveLocal, teammate: ours };
      } else {
        const tg = c.templates.find((t) => t.playerId === tmPid);
        if (tg) player = { ...liveLocal, teammate: this.buildTemplateSide(tg) };
      }
      const og = c.templates.find((t) => t.playerId !== liveOppPid && t.playerId !== tmPid && t.playerId !== localPid);
      if (og) opp.teammate = this.buildTemplateSide(og);
    }

    const input: BattleSimInput = {
      turn: c.turn,
      player,
      opponent: opp,
      availableTribes: lobbyTribesOf(g),
      mode,
    };
    const anomaly = this.anomalyCardId();
    if (anomaly) input.anomalyCardId = anomaly;
    const cap = this.damageCap(g);
    if (cap) input.damageCap = cap;
    c.input = input;
    if (mode === 'duos') {
      const pair = (a: SimSide) => {
        const b = a.teammate?.playerId ?? 0;
        if (a.playerId > 0 && b > 0 && a.playerId !== b && !g.pairs.has(a.playerId) && !g.pairs.has(b)) {
          g.pairs.set(a.playerId, b);
          g.pairs.set(b, a.playerId);
        }
      };
      pair(player);
      // A ghost (Kel'Thuzad) carries a dead player's PLAYER_ID: not evidence of a team.
      if (!/KelThuzad/.test(opp.heroCardId)) pair(opp);
    }

    // Opponent boards seen
    const now = this.now();
    const boardOf = (side: Omit<SimSide, 'teammate'>): BoardSnapshot => {
      const b: BoardSnapshot = { turn: c.turn, heroCardId: side.heroCardId, minions: side.minions, capturedAt: now };
      if (side.heroPowerCardId) b.heroPowerCardId = side.heroPowerCardId;
      if (side.trinkets.length) b.trinkets = side.trinkets.map((t) => t.cardId);
      if (side.questRewards.length) b.questRewards = side.questRewards;
      return b;
    };
    const record = (side: Omit<SimSide, 'teammate'> | undefined) => {
      if (!side || side.playerId <= 0 || side.playerId === localPid) return;
      const t = g.players.get(side.playerId);
      if (t) t.lastBoard = boardOf(side);
    };
    record(opp);
    record(opp.teammate);
    record(player.teammate);
    if (player.playerId !== localPid) record(player);

    const battle: BattleState = { status: 'waiting', turn: c.turn, input };
    g.battle = battle;
    g.battles.push(battle);
    this.bump();
    this.emit({ type: 'combatStart', turn: c.turn, input });
  }

  private pidByHeroCard(g: GameCtx, cardId: string | undefined): number {
    if (!cardId) return 0;
    let found = 0;
    for (const [pid, e] of this.leaderboardHeroes(g)) {
      if (e.cardId === cardId) {
        if (found) return 0;
        found = pid;
      }
    }
    return found;
  }

  private endCombat(g: GameCtx): void {
    const c = g.combat;
    if (!c || c.ended) return;
    if (c.installed && !c.captured) this.captureCombat(g);
    c.ended = true;
    const s = this.store;
    let ourDrop = 0;
    let oppDrop = 0;
    for (const [id, d] of c.maxDrop) {
      const side = this.sideOfHero(id);
      if (side === 'local') ourDrop = Math.max(ourDrop, d);
      else if (side === 'opp') oppDrop = Math.max(oppDrop, d);
    }
    let result: 'won' | 'lost' | 'tied';
    let damage: number;
    if (c.heroAttack) {
      // Whose hero lost Health decides; the attacker's controller alone can't (in Duos the
      // teammate's hero can make the final attack, and it isn't controlled by us).
      if (oppDrop > 0 && ourDrop === 0) result = 'won';
      else if (ourDrop > 0 && oppDrop === 0) result = 'lost';
      else result = c.heroAttack.side === 'local' ? 'won' : 'lost';
      const d = result === 'won' ? oppDrop : ourDrop;
      damage = d > 0 ? d : c.heroAttack.atk;
    } else if (oppDrop > 0 && ourDrop === 0) {
      result = 'won';
      damage = oppDrop;
    } else if (ourDrop > 0) {
      result = 'lost';
      damage = ourDrop;
    } else {
      result = 'tied';
      damage = 0;
    }
    if (!c.captured) {
      // Combat never set up (e.g. game ended at the start of combat).
      g.combat = c;
      return;
    }
    const oppPid = c.oppPid || c.input?.opponent.playerId || 0;
    const oppHero = this.leaderboardHeroes(g).get(oppPid);
    const rec: CombatRecord = {
      turn: c.turn,
      opponentPlayerId: oppPid,
      opponentHeroCardId: oppHero?.cardId ?? c.oppHeroCardId ?? c.input?.opponent.heroCardId ?? '',
      result,
      damage,
    };
    g.combats.push(rec);
    const t = g.players.get(oppPid);
    if (t) t.combatsAgainst.push(rec);
    g.battle.actual = { result, damage };
    if (g.battle.status === 'idle') g.battle.status = 'waiting';
    // Health snapshot of everyone after this combat (duos: the team's shared pool).
    const heroesAfter = this.syncPlayers(g);
    const partnersAfter = this.mode(g) === 'duos' ? this.partners(g, heroesAfter) : undefined;
    for (const pid of heroesAfter.keys()) {
      const tr = g.players.get(pid)!;
      const value = Math.max(0, this.sharedHp(g, pid, heroesAfter, partnersAfter));
      const last = tr.healthHistory[tr.healthHistory.length - 1];
      if (last && last.turn === c.turn) last.value = value;
      else tr.healthHistory.push({ turn: c.turn, value });
    }
    this.bump();
    this.emit({ type: 'combatEnd', turn: c.turn, record: rec });
    void s;
  }

  // -------------------------------------------------------------------------
  // Sides
  // -------------------------------------------------------------------------

  private buildLiveSide(g: GameCtx, side: 'local' | 'opp', playerId: number): SimSide | undefined {
    const s = this.store;
    const playerInfo = side === 'local' ? s.localPlayer : s.dummyPlayer;
    if (!playerInfo) return undefined;
    const ctl = playerInfo.playerId;
    const heroId = s.tag(playerInfo.entityId, T.HERO_ENTITY);
    let hero = s.get(heroId);
    if (side === 'local' && (!hero || isPlaceholderHero(hero.cardId)) && g.localHeroId) hero = s.get(g.localHeroId);
    if (!hero) return undefined;
    const enchants = enchantmentIndex(s);
    const minions: Entity[] = [];
    const hand: Entity[] = [];
    const trinkets: Entity[] = [];
    const rewards: Entity[] = [];
    const heroPowers: Entity[] = [];
    // The opponent's combat entities are copies created for this combat; anything older that is
    // still dummy-controlled is shop leftovers (stripped replays never remove them).
    const minId = side === 'opp' && g.combat ? g.combat.maxIdAtStart : 0;
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CONTROLLER) !== ctl) continue;
      const z = e.tags.get(T.ZONE);
      const ct = e.tags.get(T.CARDTYPE);
      if (z === Zone.PLAY) {
        if (ct === CardType.MINION) {
          if (e.id > minId) minions.push(e);
        } else if (ct === CardType.BATTLEGROUND_TRINKET) {
          if (!isTrinketPlaceholder(e.cardId)) trinkets.push(e);
        } else if (ct === CardType.BATTLEGROUND_QUEST_REWARD) rewards.push(e);
        else if (ct === CardType.HERO_POWER) heroPowers.push(e);
      } else if (z === Zone.HAND && (side === 'local' || e.id > minId)) {
        if (ct === CardType.MINION || ct === CardType.SPELL || ct === CardType.BATTLEGROUND_SPELL) hand.push(e);
      }
    }
    minions.sort((a, b) => (a.tags.get(T.ZONE_POSITION) ?? 0) - (b.tags.get(T.ZONE_POSITION) ?? 0) || a.id - b.id);
    hand.sort((a, b) => (a.tags.get(T.ZONE_POSITION) ?? 0) - (b.tags.get(T.ZONE_POSITION) ?? 0) || a.id - b.id);
    const built = this.makeSide(hero, playerId, minions, hand, trinkets, rewards, heroPowers, s.get(playerInfo.entityId), enchants, true, minId);
    let deity: Entity | undefined;
    for (const e of s.entities.values()) {
      if (e.cardId !== DEITY_OBJECTIVE || e.tags.get(T.CONTROLLER) !== ctl || e.tags.get(T.ZONE) !== Zone.SECRET) continue;
      if (!deity || e.id > deity.id) deity = e;
    }
    this.applyDeity(built, deity);
    // Secrets (The Great Akazamzarak's hero power) sit in the SECRET zone.
    const secrets: string[] = [];
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CONTROLLER) !== ctl || e.tags.get(T.ZONE) !== Zone.SECRET || !/Bacon_Secrets/.test(e.cardId)) continue;
      if (side === 'opp' && e.id <= minId) continue;
      secrets.push(e.cardId);
    }
    if (secrets.length) built.secrets = secrets;
    return built;
  }

  /**
   * Aberration lobbies: every player owns a "Secret Deity" objective (BG_OldGod) carrying the
   * number of friendly Aberration deaths that awaken the Deity (QUEST_PROGRESS_TOTAL; it differs
   * from the card data in some patches) and the Deity's current stats (script data 2 / 3). Board
   * templates (Duos teammates) have no Player entity, so this is their only source.
   */
  private applyDeity(side: Omit<SimSide, 'teammate'>, deity: Entity | undefined): void {
    if (!deity) return;
    const tags = side.playerTags;
    const need = deity.tags.get(T.QUEST_PROGRESS_TOTAL) || deity.tags.get(T.TAG_SCRIPT_DATA_NUM_1) || 0;
    if (need > 0) tags.SIM_DEITY_THRESHOLD = need;
    const atk = deity.tags.get(T.TAG_SCRIPT_DATA_NUM_2);
    const hp = deity.tags.get(T.TAG_SCRIPT_DATA_NUM_3);
    const atkName = tagName(T.BACON_OLD_GOD_ATTACK);
    const hpName = tagName(T.BACON_OLD_GOD_HEALTH);
    if (tags[atkName] === undefined && atk !== undefined) tags[atkName] = atk;
    if (tags[hpName] === undefined && hp !== undefined) tags[hpName] = hp;
    const dbf = deity.tags.get(T.BACON_EVOLUTION_CARD_ID);
    if (dbf && this.cardDb.getByDbfId(dbf)?.mechanics.includes('BACON_OLD_GOD')) tags[tagName(T.BACON_GLOBAL_OLD_GOD_DBID)] = dbf;
  }

  private makeSide(
    hero: Entity,
    playerId: number,
    minions: Entity[],
    hand: Entity[],
    trinkets: Entity[],
    rewards: Entity[],
    heroPowers: Entity[],
    playerEntity: Entity | undefined,
    enchants: Map<number, Entity[]>,
    livePositions: boolean,
    /** Hero power entities older than this are leftovers of earlier combats (opponent side). */
    minExtraHeroPowerId = 0,
  ): SimSide {
    const s = this.store;
    const db = this.cardDb;
    const hpLinked = hero.tags.get(T.HERO_POWER_ENTITY);
    const hp = heroPowers.find((h) => h.id === hpLinked) ?? heroPowers[0];
    const side: SimSide = {
      playerId,
      heroCardId: hero.cardId,
      tavernTier: hero.tags.get(T.PLAYER_TECH_LEVEL) || (playerEntity?.tags.get(T.PLAYER_TECH_LEVEL) ?? 0) || 1,
      health: (hero.tags.get(T.HEALTH) ?? 0) - (hero.tags.get(T.DAMAGE) ?? 0),
      armor: hero.tags.get(T.ARMOR) ?? 0,
      minions: minions.map((m, i) => minionSnapshot(m, s, db, enchants, livePositions ? undefined : i + 1)),
      hand: hand.map((m) => minionSnapshot(m, s, db, enchants)),
      trinkets: trinkets.map((t) => {
        const o: { cardId: string; scriptData1?: number; scriptData2?: number } = { cardId: t.cardId };
        const a = t.tags.get(T.TAG_SCRIPT_DATA_NUM_1);
        const b = t.tags.get(T.TAG_SCRIPT_DATA_NUM_2);
        if (a !== undefined) o.scriptData1 = a;
        if (b !== undefined) o.scriptData2 = b;
        return o;
      }),
      questRewards: rewards.map((r) => r.cardId),
      playerTags: this.playerTagsOf(playerEntity),
      heroTags: tagsRecord(hero),
    };
    if (hp) {
      side.heroPowerCardId = hp.cardId;
      side.heroPowerUsed = (hp.tags.get(T.EXHAUSTED) ?? 0) > 0 || (hp.tags.get(T.BACON_HERO_POWER_ACTIVATED) ?? 0) > 0;
      const d1 = hp.tags.get(T.TAG_SCRIPT_DATA_NUM_1);
      const d2 = hp.tags.get(T.TAG_SCRIPT_DATA_NUM_2);
      const d3 = hp.tags.get(T.TAG_SCRIPT_DATA_NUM_3);
      if (d1 !== undefined || d2 !== undefined || d3 !== undefined) {
        side.heroPowerData = {};
        if (d1 !== undefined) side.heroPowerData.scriptData1 = d1;
        if (d2 !== undefined) side.heroPowerData.scriptData2 = d2;
        if (d3 !== undefined) side.heroPowerData.scriptData3 = d3;
      }
      // Second hero power (Reinvigorating Light...): the newest other hero power card in play.
      const extras = new Map<string, Entity>();
      for (const o of heroPowers) {
        if (o === hp || o.cardId === hp.cardId || !o.cardId || o.id < minExtraHeroPowerId) continue;
        const prev = extras.get(o.cardId);
        if (!prev || o.id > prev.id) extras.set(o.cardId, o);
      }
      if (extras.size) {
        side.extraHeroPowers = [...extras.values()].map((o) => {
          const x: NonNullable<SimSide['extraHeroPowers']>[number] = {
            cardId: o.cardId,
            used: (o.tags.get(T.EXHAUSTED) ?? 0) > 0 || (o.tags.get(T.BACON_HERO_POWER_ACTIVATED) ?? 0) > 0,
          };
          const a = o.tags.get(T.TAG_SCRIPT_DATA_NUM_1);
          const b2 = o.tags.get(T.TAG_SCRIPT_DATA_NUM_2);
          const c3 = o.tags.get(T.TAG_SCRIPT_DATA_NUM_3);
          if (a !== undefined) x.scriptData1 = a;
          if (b2 !== undefined) x.scriptData2 = b2;
          if (c3 !== undefined) x.scriptData3 = c3;
          return x;
        });
      }
    } else {
      const hpCard = db.getByDbfId(hero.tags.get(T.HERO_POWER))?.id ?? db.get(hero.cardId)?.heroPowerId;
      if (hpCard) side.heroPowerCardId = hpCard;
    }
    return side;
  }

  /**
   * All tags of the Player entity (blood gem / tavern spell / Old God counters...), plus the
   * lobby-wide GameEntity tags the simulator reads from playerTags (e.g. BACON_GLOBAL_OLD_GOD_DBID).
   */
  /** Duos: remember both Player entities' tags under the PLAYER_ID currently fighting for them. */
  private cacheFighterTags(g: GameCtx): void {
    const s = this.store;
    for (const pl of [s.localPlayer, s.dummyPlayer]) {
      if (!pl) continue;
      const pid = s.tag(pl.entityId, T.BACON_CURRENT_COMBAT_PLAYER_ID);
      const e = s.get(pl.entityId);
      if (pid <= 0 || !e) continue;
      // A Kel'Thuzad ghost fights with the dummy's own tags, not the dead player's.
      if (pl === s.dummyPlayer && /KelThuzad/.test(s.get(s.tag(pl.entityId, T.HERO_ENTITY))?.cardId ?? '')) continue;
      g.playerTagCache.set(pid, new Map(e.tags));
    }
  }

  private playerTagsOf(playerEntity: Entity | undefined, cached?: Map<number, number>): Record<string, number> {
    const out: Record<string, number> = {};
    if (playerEntity) Object.assign(out, tagsRecord(playerEntity));
    else if (cached) for (const [k, v] of cached) out[tagName(k)] = v;
    const ge = this.store.game;
    if (ge) {
      for (const t of GLOBAL_GAME_TAGS) {
        const v = ge.tags.get(t);
        if (v !== undefined && out[tagName(t)] === undefined) out[tagName(t)] = v;
      }
    }
    return out;
  }

  private buildTemplateSide(t: TemplateGroup): Omit<SimSide, 'teammate'> {
    const s = this.store;
    const hero = s.get(t.heroId)!;
    const lctl = this.localController;
    const memberSet = new Set(t.members);
    const members = t.members
      .map((id) => s.get(id))
      .filter((e): e is Entity => {
        if (!e) return false;
        // Backups of the local board (created right after the last template) are not part of it.
        const src = s.get(e.tags.get(T.COPIED_FROM_ENTITY_ID));
        return !(src && src.id !== e.id && !memberSet.has(src.id) && src.cardId === e.cardId && src.tags.get(T.CONTROLLER) === lctl);
      });
    const byType = (ct: number) => members.filter((e) => e.tags.get(T.CARDTYPE) === ct);
    // Hand cards inside a template carry a "Costs 0" shop enchantment (TB_BaconShopBadsongE).
    const inHand = new Set<number>();
    for (const e of s.entities.values()) {
      if (e.cardId === 'TB_BaconShopBadsongE' && memberSet.has(e.tags.get(T.ATTACHED) ?? -1)) inHand.add(e.tags.get(T.ATTACHED)!);
    }
    const isHand = (e: Entity) => e.tags.get(T.ZONE) === Zone.HAND || inHand.has(e.id);
    const cards = members.filter((e) => {
      const ct = e.tags.get(T.CARDTYPE);
      return ct === CardType.MINION || ct === CardType.SPELL || ct === CardType.BATTLEGROUND_SPELL;
    });
    const side = this.makeSide(
      hero,
      t.playerId,
      byType(CardType.MINION).filter((e) => !isHand(e)),
      cards.filter(isHand),
      byType(CardType.BATTLEGROUND_TRINKET).filter((e) => !isTrinketPlaceholder(e.cardId)),
      byType(CardType.BATTLEGROUND_QUEST_REWARD),
      byType(CardType.HERO_POWER),
      undefined,
      enchantmentIndex(s),
      false,
    );
    // The template's own player enchant is hidden: use the tags last seen while this player fought.
    const cached = this.g?.playerTagCache.get(t.playerId);
    if (cached) {
      side.playerTags = this.playerTagsOf(undefined, cached);
      side.playerTags[tagName(T.PLAYER_ID)] = t.playerId;
    }
    this.applyDeity(side, members.find((e) => e.cardId === DEITY_OBJECTIVE));
    return side;
  }

  // -------------------------------------------------------------------------
  // Game end
  // -------------------------------------------------------------------------

  /** Local player reached a final PLAYSTATE: stop combat tracking (the server keeps simulating). */
  private endGame(g: GameCtx): void {
    if (g.ended) return;
    if (g.combat && !g.combat.ended) this.endCombat(g);
    this.noteOwnedItems(g);
    g.trinketChoice = undefined;
    g.ended = true;
    g.endedAt = this.now();
    g.endedTs = this.logTs;
    const heroes = this.syncPlayers(g);
    const turn = this.bgTurn();
    const partners = this.mode(g) === 'duos' ? this.partners(g, heroes) : undefined;
    for (const pid of heroes.keys()) {
      const tr = g.players.get(pid)!;
      const value = Math.max(0, this.sharedHp(g, pid, heroes, partners));
      const last = tr.healthHistory[tr.healthHistory.length - 1];
      if (!last || last.value !== value) {
        if (last && last.turn === turn) last.value = value;
        else tr.healthHistory.push({ turn, value });
      }
    }
    g.finalPlacement = this.currentPlacement(g);
    this.bump();
  }

  /**
   * Placement of the local player. NB: after a loss the client updates the local hero's
   * PLAYER_LEADERBOARD_PLACE only AFTER PLAYSTATE=LOST, so read it as late as possible.
   */
  private currentPlacement(g: GameCtx): number | undefined {
    const s = this.store;
    const lp = s.localPlayer;
    if (lp && s.tag(lp.entityId, T.PLAYSTATE) === PlayState.WON) return 1;
    const place = s.tag(g.localHeroId, T.PLAYER_LEADERBOARD_PLACE);
    return place > 0 ? place : undefined;
  }

  /** Game over for good (GameEntity STATE=COMPLETE, next CREATE_GAME or flush): emit gameEnd. */
  private finishGame(g: GameCtx): void {
    if (g.matchRecord) return;
    if (!g.ended) this.endGame(g);
    g.finalPlacement = this.currentPlacement(g) ?? g.finalPlacement;
    const s = this.store;
    const lh = s.get(g.localHeroId);
    const turn = this.bgTurn();
    const state = this.buildState();
    const local = state.players.find((p) => p.isLocal);
    const heroCardId = lh?.cardId ?? g.chosenHeroCardId ?? '';
    const finalBoard = state.localBoard.length ? state.localBoard : g.lastLocalBoard;
    const rec: MatchRecord = {
      id: g.gameId,
      startedAt: g.startedAt,
      endedAt: g.endedAt ?? this.now(),
      mode: state.mode,
      gameType: g.gameType,
      heroCardId,
      heroName: local?.heroName ?? (heroCardId ? this.cardDb.name(heroCardId) : ''),
      baseHeroCardId: heroCardId ? this.cardDb.baseHeroId(heroCardId) : '',
      heroOptions: state.heroOptions.map((o) => o.cardId),
      placement: g.finalPlacement ?? 0,
      turns: turn,
      finalTier: local?.tavernTier ?? 0,
      finalBoard,
      availableTribes: state.availableTribes,
      tierHistory: local?.tierHistory ?? [],
      combats: g.combats.slice(),
      healthHistory: local?.healthHistory ?? [],
      lobby: state.players.map((p) => {
        const o: MatchRecord['lobby'][number] = {
          playerId: p.playerId,
          heroCardId: p.heroCardId,
          place: p.leaderboardPlace,
        };
        if (p.name) o.name = p.name;
        if (p.teamId !== undefined) o.teamId = p.teamId;
        return o;
      }),
    };
    if (state.anomalyCardId) rec.anomalyCardId = state.anomalyCardId;
    const trinkets = this.pickedTrinkets(g);
    if (trinkets.length) rec.trinkets = trinkets;
    if (g.ownedRewards.length) rec.questRewards = g.ownedRewards.slice();
    g.matchRecord = JSON.parse(JSON.stringify(rec)) as MatchRecord;
    this.bump();
    this.emit({ type: 'gameEnd', record: rec });
  }

  // -------------------------------------------------------------------------
  // State snapshot
  // -------------------------------------------------------------------------

  private anomalyCardId(): string | undefined {
    const s = this.store;
    const dbf = s.tag(s.gameEntityId, T.BACON_GLOBAL_ANOMALY_DBID);
    if (dbf) {
      const c = this.cardDb.getByDbfId(dbf);
      if (c) return c.id;
    }
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CARDTYPE) === CardType.BATTLEGROUND_ANOMALY && e.cardId) return e.cardId;
    }
    return undefined;
  }

  private damageCap(g: GameCtx): number | undefined {
    const s = this.store;
    const cap = s.tag(s.gameEntityId, T.BACON_COMBAT_DAMAGE_CAP);
    if (!cap) return undefined;
    if (g.damageCapEnabled === false) return undefined;
    return cap;
  }

  /** Bob's current offers (dummy-controlled minions/spells in PLAY during the recruit phase). */
  private shopOffers(g: GameCtx): ShopOffer[] {
    const s = this.store;
    const dummy = this.dummyController;
    const ents: Entity[] = [];
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CONTROLLER) !== dummy || e.tags.get(T.ZONE) !== Zone.PLAY) continue;
      const ct = e.tags.get(T.CARDTYPE);
      if (ct === CardType.MINION || ct === CardType.BATTLEGROUND_SPELL || ct === CardType.SPELL) ents.push(e);
    }
    ents.sort((a, b) => (a.tags.get(T.ZONE_POSITION) ?? 0) - (b.tags.get(T.ZONE_POSITION) ?? 0) || a.id - b.id);
    void g;
    return ents.map((e) => shopOffer(e, this.cardDb));
  }

  /**
   * The lobby's tribes from outside the log (read from the hero-pick screen). Ignored when
   * no Battlegrounds game is running or the game already ended. Returns true if it changed.
   */
  setLobbyTribes(tribes: Tribe[]): boolean {
    const g = this.g;
    if (!g || !g.isBg || g.ended || !tribes.length) return false;
    const next = [...new Set(tribes)].sort();
    if (g.screenTribes && g.screenTribes.join() === next.join()) return false;
    g.screenTribes = next;
    this._version++;
    return true;
  }

  getState(): BgGameState {
    if (this.cache && this.cache.version === this._version) return this.cache.state;
    const state = this.buildState();
    this.cache = { version: this._version, state };
    return state;
  }

  private buildState(): BgGameState {
    const g = this.g && this.g.isBg ? this.g : undefined;
    if (!g) {
      return {
        gameId: '',
        active: false,
        gameType: this.g?.gameType ?? '',
        mode: 'solo',
        spectating: this.spectating,
        phase: 'idle',
        turn: 0,
        heroOptions: [],
        players: [],
        availableTribes: [],
        tribesSource: 'unknown',
        shop: [],
        localBoard: [],
        localHand: [],
        battle: { ...EMPTY_BATTLE },
        battles: [],
        startedAt: 0,
      };
    }
    const s = this.store;
    const db = this.cardDb;
    const heroes = this.leaderboardHeroes(g);
    const lp = s.localPlayer;
    const localPid = this.localPid(g);
    const nextOpp = lp ? s.tag(lp.entityId, T.NEXT_OPPONENT_PLAYER_ID) || s.tag(g.localHeroId, T.NEXT_OPPONENT_PLAYER_ID) : 0;
    // GameState lines arrive as soon as the server sends them: a combat is fully
    // resolved in the log within a fraction of a second, while the client animates it
    // for 20-40 s. When PowerTaskList lines are present (log.config Verbose=true), follow
    // their animation-paced turn/board state for what the player is watching.
    const pb = g.playback;
    const gsTurn = s.tag(s.gameEntityId, T.TURN);
    const followPlayback = this.followsPlayback(g);
    this.followed = followPlayback;
    const turn = followPlayback ? Math.ceil(pb.turn / 2) : this.bgTurn();
    const inCombat = !!g.combat && !g.combat.ended;
    const mode = this.mode(g);
    const teammate = mode === 'duos' ? this.teammatePid() : 0;

    let phase: BgGameState['phase'];
    if (followPlayback) phase = pb.visual === 2 || pb.turn % 2 === 0 ? 'combat' : 'recruit';
    else if (g.ended) phase = 'gameOver';
    else if (inCombat) phase = 'combat';
    else if (turn === 0) phase = 'heroSelection';
    else if (s.tag(s.gameEntityId, T.TURN) % 2 === 0) phase = 'combat';
    else phase = 'recruit';

    // Shop (recruit only). While the playback still shows the previous shop and GameState
    // is in combat, the dummy player's minions are the opponent's board, not a shop.
    const shop = phase === 'recruit' && !inCombat && gsTurn % 2 === 1 ? this.shopOffers(g) : [];

    // Local live board / hand
    const enchants = enchantmentIndex(s);
    let localBoard: MinionSnapshot[] = [];
    let localHand: MinionSnapshot[] = [];
    const lctl = this.localController;
    if (inCombat && g.combat) localBoard = g.combat.localBoardAtStart;
    const boardEnts: Entity[] = [];
    const handEnts: Entity[] = [];
    let localHp: Entity | undefined;
    const localTrinkets: string[] = [];
    const localRewards: string[] = [];
    for (const e of s.entities.values()) {
      if (e.tags.get(T.CONTROLLER) !== lctl) continue;
      const z = e.tags.get(T.ZONE);
      const ct = e.tags.get(T.CARDTYPE);
      if (z === Zone.PLAY) {
        if (ct === CardType.MINION) boardEnts.push(e);
        else if (ct === CardType.HERO_POWER) {
          const linked = s.tag(g.localHeroId, T.HERO_POWER_ENTITY);
          if (!localHp || e.id === linked) localHp = e;
        } else if (ct === CardType.BATTLEGROUND_TRINKET) {
          if (!isTrinketPlaceholder(e.cardId)) localTrinkets.push(e.cardId);
        }
        else if (ct === CardType.BATTLEGROUND_QUEST_REWARD) localRewards.push(e.cardId);
      } else if (z === Zone.HAND && (ct === CardType.MINION || ct === CardType.SPELL || ct === CardType.BATTLEGROUND_SPELL)) handEnts.push(e);
    }
    const byPos = (a: Entity, b: Entity) => (a.tags.get(T.ZONE_POSITION) ?? 0) - (b.tags.get(T.ZONE_POSITION) ?? 0) || a.id - b.id;
    if (!inCombat) {
      boardEnts.sort(byPos);
      localBoard = boardEnts.map((e) => minionSnapshot(e, s, db, enchants));
    }
    handEnts.sort(byPos);
    localHand = handEnts.map((e) => minionSnapshot(e, s, db, enchants));

    const players: PlayerState[] = [];
    const emptyTrack: PlayerTrack = { playerId: 0, heroEntityId: 0, tierHistory: [], maxTier: 1, healthHistory: [], combatsAgainst: [], nameVotes: new Map(), dead: false };
    for (const [pid, e] of heroes) {
      const tr = g.players.get(pid) ?? emptyTrack;
      const isLocal = pid === localPid && e.id === g.localHeroId;
      const card = db.get(e.cardId);
      const health = (e.tags.get(T.HEALTH) ?? 0) - (e.tags.get(T.DAMAGE) ?? 0);
      const p: PlayerState = {
        playerId: pid,
        heroEntityId: e.id,
        heroCardId: e.cardId,
        heroName: displayName(e, db),
        isLocal,
        health,
        maxHealth: e.tags.get(T.HEALTH) ?? card?.health ?? 0,
        armor: e.tags.get(T.ARMOR) ?? 0,
        tavernTier: e.tags.get(T.PLAYER_TECH_LEVEL) || 1,
        triples: e.tags.get(T.PLAYER_TRIPLES) ?? 0,
        leaderboardPlace: e.tags.get(T.PLAYER_LEADERBOARD_PLACE) ?? 0,
        dead: tr.dead || ((e.tags.get(T.HEALTH) ?? 0) > 0 && health <= 0),
        isNextOpponent: pid === nextOpp && !isLocal,
        tierHistory: tr.tierHistory.slice(),
        combatsAgainst: tr.combatsAgainst.slice(),
        healthHistory: tr.healthHistory.slice(),
      };
      if (tr.diedOnTurn !== undefined) p.diedOnTurn = tr.diedOnTurn;
      if (isLocal) {
        if (lp?.name) p.name = lp.name;
        if (localHp) p.heroPowerCardId = localHp.cardId;
        if (localTrinkets.length) p.trinkets = localTrinkets;
        if (localRewards.length) p.questRewards = localRewards;
      } else {
        const name = this.bestName(tr, g);
        if (name) p.name = name;
        if (tr.lastBoard) {
          p.lastBoard = tr.lastBoard;
          const mt = mainTribes(tr.lastBoard.minions);
          if (mt.length) p.mainTribes = mt;
          if (tr.lastBoard.trinkets) p.trinkets = tr.lastBoard.trinkets;
          if (tr.lastBoard.questRewards) p.questRewards = tr.lastBoard.questRewards;
          if (tr.lastBoard.heroPowerCardId) p.heroPowerCardId = tr.lastBoard.heroPowerCardId;
        }
        if (!p.heroPowerCardId) {
          const hp = db.getByDbfId(e.tags.get(T.HERO_POWER))?.id ?? card?.heroPowerId;
          if (hp) p.heroPowerCardId = hp;
        }
      }
      if (mode === 'duos') {
        const team = this.teamIdOf(g, pid, e);
        if (team) p.teamId = team;
      }
      players.push(p);
    }
    const partners = mode === 'duos' ? this.mergeTeams(g, players, heroes, teammate) : undefined;
    players.sort((a, b) => (a.leaderboardPlace || 99) - (b.leaderboardPlace || 99) || a.playerId - b.playerId);

    let currentOpponentPlayerId: number | undefined;
    if (inCombat && g.combat) {
      const dp = s.dummyPlayer;
      const cur = dp ? s.tag(dp.entityId, T.BACON_CURRENT_COMBAT_PLAYER_ID) : 0;
      const hero = dp ? s.get(s.tag(dp.entityId, T.HERO_ENTITY)) : undefined;
      currentOpponentPlayerId = cur || (hero && !g.bobIds.has(hero.id) ? hero.tags.get(T.PLAYER_ID) : 0) || g.combat.input?.opponent.playerId || g.combat.oppPid || undefined;
    } else if (phase === 'combat' && followPlayback && g.combat && g.combat.turn === turn) {
      // GameState already resolved the combat that is still being animated.
      currentOpponentPlayerId = g.combat.input?.opponent.playerId || g.combat.oppPid || undefined;
    }

    const resources = lp ? s.tag(lp.entityId, T.RESOURCES) : 0;
    const gold = lp ? resources - s.tag(lp.entityId, T.RESOURCES_USED) + s.tag(lp.entityId, T.TEMP_RESOURCES) : undefined;

    const state: BgGameState = {
      gameId: g.gameId,
      active: true,
      gameType: g.gameType,
      mode,
      spectating: this.spectating,
      phase,
      turn,
      heroOptions: this.heroOptions(g),
      players,
      availableTribes: lobbyTribesOf(g),
      tribesSource: g.screenTribes ? 'screen' : g.tribes.size ? 'inferred' : 'unknown',
      shop,
      localBoard,
      localHand,
      battle: g.battle,
      battles: g.battles,
      startedAt: g.startedAt,
    };
    // The outcome (battle.actual) is shown as soon as the log knows it, usually within a
    // second of the combat starting, while the fight is still being animated.
    if (g.buildNumber) state.buildNumber = g.buildNumber;
    if (localPid) state.localPlayerId = localPid;
    if (lp?.name) state.localPlayerName = lp.name;
    if (g.chosenHeroCardId) state.chosenHeroCardId = g.chosenHeroCardId;
    const trinketOptions = this.trinketOptions(g);
    if (trinketOptions) state.trinketOptions = trinketOptions;
    if (nextOpp) state.nextOpponentPlayerId = nextOpp;
    const nextMate = partners && nextOpp ? (lp ? s.tag(lp.entityId, T.NEXT_OPPONENT_TEAMMATE_PLAYER_ID) : 0) || partners.get(nextOpp) || 0 : 0;
    if (nextMate && nextMate !== nextOpp) state.nextOpponentTeammatePlayerId = nextMate;
    if (currentOpponentPlayerId) state.currentOpponentPlayerId = currentOpponentPlayerId;
    const anomaly = this.anomalyCardId();
    if (anomaly) state.anomalyCardId = anomaly;
    const ge = s.game;
    if (ge?.tags.has(T.BACON_TRINKETS_ACTIVE)) state.trinketsActive = (ge.tags.get(T.BACON_TRINKETS_ACTIVE) ?? 0) > 0;
    if (ge?.tags.has(T.BACON_QUESTS_ACTIVE)) state.questsActive = (ge.tags.get(T.BACON_QUESTS_ACTIVE) ?? 0) > 0;
    if (lp && gold !== undefined && turn > 0) {
      state.gold = Math.max(0, gold);
      state.maxGold = resources;
    }
    if (lp && turn > 0) {
      const counters = localCounters(s, db, lctl, lp.entityId, g.localHeroId, g.counterSeen);
      if (counters) state.counters = counters;
      if (g.apm.turn > 0) {
        const a = g.apm;
        state.apm = { turn: a.turn, turnActions: a.turnActions, inShop: !!a.turnStartTs, pastActions: a.pastActions, pastMs: a.pastMs };
        if (a.last) state.apm.last = { ...a.last };
      }
    }
    const placement = g.ended && !g.matchRecord ? (this.currentPlacement(g) ?? g.finalPlacement) : g.finalPlacement;
    if (placement !== undefined) state.finalPlacement = placement;
    if (g.endedAt !== undefined) state.endedAt = g.endedAt;
    // Plain JSON (no shared references with internal state).
    return JSON.parse(JSON.stringify(state)) as BgGameState;
  }

  /**
   * Follow the PowerTaskList (animation-paced) turn and board state rather than the
   * GameState one? Only while it is within MAX_PLAYBACK_LAG_MS of GameState.
   */
  private followsPlayback(g: GameCtx): boolean {
    const pb = g.playback;
    if (!pb.seen || pb.turn <= 0 || (g.ended && pb.complete)) return false;
    const gsTurn = this.store.tag(this.store.gameEntityId, T.TURN);
    // Ahead of GameState: a previous game's / connection's leftovers.
    if (pb.turn > gsTurn) return false;
    // Since when GameState has been ahead of what is animated.
    let since: string | undefined;
    if (pb.turn < gsTurn) {
      for (let t = pb.turn + 1; t <= gsTurn && since === undefined; t++) since = g.turnTs.get(t);
      if (since === undefined) return false; // can't tell how stale it is (reconnect)
    } else if (g.ended) since = g.endedTs;
    if (since === undefined) return true; // caught up
    const lag = logTimeDiff(this.logTs, since);
    if (Number.isNaN(lag)) return true; // no timestamps in this log
    const idle = this.idle && this.idle.ts === this.logTs ? Math.max(0, this.now() - this.idle.at) : 0;
    return lag + idle <= MAX_PLAYBACK_LAG_MS;
  }

  // -------------------------------------------------------------------------
  // Opponent names (the dummy player is printed under the current opponent's name)
  // -------------------------------------------------------------------------

  private onName(entityId: number, name: string): void {
    const g = this.g;
    if (!g || !g.isBg) return;
    const s = this.store;
    if (!s.isDummy(entityId)) return;
    const c = g.combat;
    if (c && c.captured && !c.ended) {
      // A Kel'Thuzad ghost is printed as "Kel'Thuzad", not as the dead player.
      if (c.input && /KelThuzad/.test(c.input.opponent.heroCardId)) return;
      const dp = s.dummyPlayer!;
      const hero = s.get(s.tag(dp.entityId, T.HERO_ENTITY));
      // Duos: the dummy keeps the FIRST enemy fighter's name for the whole combat, also
      // while their teammate fights.
      const pid =
        (this.mode(g) === 'duos' ? c.input?.opponent.playerId || 0 : 0) ||
        s.tag(dp.entityId, T.BACON_CURRENT_COMBAT_PLAYER_ID) ||
        (hero && !g.bobIds.has(hero.id) ? (hero.tags.get(T.PLAYER_ID) ?? 0) : 0) ||
        c.input?.opponent.playerId ||
        c.oppPid;
      const t = pid ? g.players.get(pid) : undefined;
      if (t) t.nameVotes.set(name, (t.nameVotes.get(name) ?? 0) + 1);
    } else if (!g.firstCombatSeen) g.shopNames.add(name);
  }

  private bestName(tr: PlayerTrack, g: GameCtx): string | undefined {
    let best: string | undefined;
    let n = 0;
    for (const [name, c] of tr.nameVotes) {
      if (g.shopNames.has(name)) continue;
      if (c > n) {
        n = c;
        best = name;
      }
    }
    return best;
  }

  /**
   * Duos: teammates share one health pool, one leaderboard place and die together, but the
   * client updates their two leaderboard heroes one after the other (sometimes a turn
   * apart): use the freshest values for both, and complete team ids / the teammate flag.
   */
  private mergeTeams(g: GameCtx, players: PlayerState[], heroes: Map<number, Entity>, teammatePid: number): Map<number, number> {
    const partners = this.partners(g, heroes);
    const local = players.find((p) => p.isLocal);
    const mateOfLocal = teammatePid > 0 ? teammatePid : local ? (partners.get(local.playerId) ?? 0) : 0;
    const byPid = new Map(players.map((p) => [p.playerId, p]));
    const raw = new Map(players.map((p) => [p.playerId, { dead: p.dead, diedOnTurn: p.diedOnTurn, teamId: p.teamId }]));
    for (const p of players) {
      if (p.playerId === mateOfLocal && !p.isLocal) p.isTeammate = true;
      else if (p.isTeammate) delete p.isTeammate;
      const mate = partners.get(p.playerId);
      const q = mate ? byPid.get(mate) : undefined;
      if (!q) continue;
      const hpHero = this.freshestOf(heroes, p.playerId, mate, g.hpSeq);
      if (hpHero) {
        p.health = (hpHero.tags.get(T.HEALTH) ?? 0) - (hpHero.tags.get(T.DAMAGE) ?? 0);
        p.armor = hpHero.tags.get(T.ARMOR) ?? 0;
        p.maxHealth = hpHero.tags.get(T.HEALTH) ?? p.maxHealth;
      }
      const placeHero = this.freshestOf(heroes, p.playerId, mate, g.placeSeq);
      const place = placeHero?.tags.get(T.PLAYER_LEADERBOARD_PLACE) ?? 0;
      if (place > 0) p.leaderboardPlace = place;
      const rq = raw.get(q.playerId)!;
      const rp = raw.get(p.playerId)!;
      p.dead = rp.dead || rq.dead || ((hpHero?.tags.get(T.HEALTH) ?? 0) > 0 && p.health <= 0);
      const died = [rp.diedOnTurn, rq.diedOnTurn].filter((t): t is number => t !== undefined);
      if (died.length) p.diedOnTurn = Math.min(...died);
      if (rp.teamId === undefined) p.teamId = rq.teamId ?? 100 + Math.min(p.playerId, q.playerId);
    }
    return partners;
  }

  /** Last resolved match record (after gameEnd). */
  getMatchRecord(): MatchRecord | undefined {
    return this.g?.matchRecord ? (JSON.parse(JSON.stringify(this.g.matchRecord)) as MatchRecord) : undefined;
  }
}

/** Lobby tribes: the hero-pick screen's list when read, else those seen in the shop. */
function lobbyTribesOf(g: GameCtx): Tribe[] {
  return g.screenTribes ? g.screenTribes.slice() : [...g.tribes].sort();
}
