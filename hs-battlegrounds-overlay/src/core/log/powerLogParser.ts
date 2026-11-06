/**
 * Streaming parser for Hearthstone's Power.log.
 *
 * Turns raw log lines into typed packets (CREATE_GAME, FULL_ENTITY, TAG_CHANGE,
 * BLOCK_START, ...). It is purely syntactic: it does not resolve player names or
 * keep entity state (see `src/core/game/entityStore.ts` for that).
 *
 * Line shape: `D 13:18:11.0621247 GameState.DebugPrintPower() -     TAG_CHANGE Entity=... tag=ZONE value=PLAY `
 *
 * Hearthstone may print the same packets twice: once from `GameState.DebugPrintPower()`
 * (when the packets arrive) and once from `PowerTaskList.DebugPrintPower()` (when they
 * are played back with animations). We only use ONE source: whichever printed the
 * first CREATE_GAME. `DebugPrintGame()`, `DebugPrintEntityChoices()` and
 * `DebugPrintEntitiesChosen()` only exist on GameState and are always parsed.
 *
 * Multi-line packets (FULL_ENTITY + its `tag=` lines, META_DATA + `Info[i]`, choices +
 * `Entities[i]`, SUB_SPELL_START + `Source`/`Targets[i]`) are emitted once the next
 * unrelated line arrives, or on `flush()`.
 */
import {
  CardClass,
  CardType,
  GameTag,
  GameTag_BY_ID,
  Mulligan,
  PlayState,
  Race,
  State,
  Step,
  Zone,
  BlockType,
  ChoiceType,
  MetaDataType,
} from './enums';

export type LogSource = 'GameState' | 'PowerTaskList';

/** A reference to an entity as printed in the log. */
export interface EntityRef {
  /** 'game' = `GameEntity`; 'id' = numeric or `[entityName=... id=N ...]`; 'name' = a player name. */
  kind: 'game' | 'id' | 'name';
  id?: number;
  /** entityName (bracket refs) or player name ('name' refs). */
  name?: string;
  cardId?: string;
  zone?: string;
  zonePos?: number;
  /** Controller PlayerID printed in bracket refs. */
  player?: number;
}

/** [tagId, value] pairs in log order. */
export type TagList = Array<[number, number]>;

interface PacketBase {
  /** `HH:MM:SS.fffffff` timestamp of the line ('' if the line had none). */
  ts: string;
}

export interface CreateGamePacket extends PacketBase {
  type: 'CreateGame';
  source: LogSource;
}
export interface GameEntityPacket extends PacketBase {
  type: 'GameEntity';
  id: number;
  tags: TagList;
}
export interface PlayerPacket extends PacketBase {
  type: 'Player';
  id: number;
  playerId: number;
  accountHi: string;
  accountLo: string;
  tags: TagList;
}
export interface FullEntityPacket extends PacketBase {
  type: 'FullEntity';
  id: number;
  cardId: string;
  tags: TagList;
}
export interface ShowEntityPacket extends PacketBase {
  type: 'ShowEntity';
  entity: EntityRef;
  cardId: string;
  tags: TagList;
}
export interface ChangeEntityPacket extends PacketBase {
  type: 'ChangeEntity';
  entity: EntityRef;
  cardId: string;
  tags: TagList;
}
export interface HideEntityPacket extends PacketBase {
  type: 'HideEntity';
  entity: EntityRef;
  zone: number;
}
export interface TagChangePacket extends PacketBase {
  type: 'TagChange';
  entity: EntityRef;
  tag: number;
  value: number;
  /** `DEF CHANGE` suffix (definition change). */
  def?: boolean;
}
export interface BlockStartPacket extends PacketBase {
  type: 'BlockStart';
  blockType: number;
  entity: EntityRef;
  effectCardId: string;
  effectIndex: number;
  target?: EntityRef;
  subOption: number;
  triggerKeyword?: string;
}
export interface BlockEndPacket extends PacketBase {
  type: 'BlockEnd';
}
export interface MetaDataPacket extends PacketBase {
  type: 'MetaData';
  meta: number;
  data: number;
  info: EntityRef[];
}
export interface SubSpellStartPacket extends PacketBase {
  type: 'SubSpellStart';
  prefab: string;
  source?: EntityRef;
  targets: EntityRef[];
}
export interface SubSpellEndPacket extends PacketBase {
  type: 'SubSpellEnd';
}
/** One `GameState.DebugPrintGame()` line. */
export interface GameInfoPacket extends PacketBase {
  type: 'GameInfo';
  key: 'BuildNumber' | 'GameType' | 'FormatType' | 'ScenarioID' | 'Player' | 'Other';
  value: string;
  /** For key 'Player'. */
  playerId?: number;
  playerName?: string;
}
export interface EntityChoicesPacket extends PacketBase {
  type: 'EntityChoices';
  choiceId: number;
  player: EntityRef;
  taskList?: number;
  choiceType: number;
  countMin: number;
  countMax: number;
  source?: EntityRef;
  entities: EntityRef[];
}
export interface EntitiesChosenPacket extends PacketBase {
  type: 'EntitiesChosen';
  choiceId: number;
  player: EntityRef;
  entities: EntityRef[];
}

export type Packet =
  | CreateGamePacket
  | GameEntityPacket
  | PlayerPacket
  | FullEntityPacket
  | ShowEntityPacket
  | ChangeEntityPacket
  | HideEntityPacket
  | TagChangePacket
  | BlockStartPacket
  | BlockEndPacket
  | MetaDataPacket
  | SubSpellStartPacket
  | SubSpellEndPacket
  | GameInfoPacket
  | EntityChoicesPacket
  | EntitiesChosenPacket;

// ---------------------------------------------------------------------------
// Tag / value normalisation
// ---------------------------------------------------------------------------

const FACTION: Record<string, number> = { INVALID: 0, HORDE: 1, ALLIANCE: 2, NEUTRAL: 3 };
const RARITY: Record<string, number> = { INVALID: 0, COMMON: 1, FREE: 2, RARE: 3, EPIC: 4, LEGENDARY: 5 };

const VALUE_ENUMS: Record<number, Record<string, number>> = {
  [GameTag.ZONE]: Zone,
  [GameTag.CARDTYPE]: CardType,
  [GameTag.STEP]: Step,
  [GameTag.NEXT_STEP]: Step,
  [GameTag.PLAYSTATE]: PlayState,
  [GameTag.STATE]: State,
  [GameTag.MULLIGAN_STATE]: Mulligan,
  [GameTag.CARDRACE]: Race,
  [GameTag.CLASS]: CardClass,
  [GameTag.FACTION]: FACTION,
  [GameTag.RARITY]: RARITY,
};
const ALL_VALUE_ENUMS = [Zone, CardType, Step, PlayState, State, Mulligan, Race, CardClass, FACTION, RARITY];

/** Dynamic name->id for tag names unknown to enums.ts (keeps names stable within a run). */
const unknownTagNames = new Map<string, number>();
let nextUnknownTagId = -1;

/** Tag name or number (as printed) -> numeric tag id. Unknown names get negative synthetic ids. */
export function tagId(s: string): number {
  const c = s.charCodeAt(0);
  if (c >= 48 && c <= 57) return parseInt(s, 10);
  const id = GameTag[s];
  if (id !== undefined) return id;
  let u = unknownTagNames.get(s);
  if (u === undefined) {
    u = nextUnknownTagId--;
    unknownTagNames.set(s, u);
    unknownTagIdNames.set(u, s);
  }
  return u;
}
const unknownTagIdNames = new Map<number, string>();

/** Canonical key used for tags in snapshots: GameTag name, or the numeric id as string. */
export function tagName(id: number): string {
  if (id < 0) return unknownTagIdNames.get(id) ?? String(id);
  return GameTag_BY_ID[id] ?? String(id);
}

/** Parse a printed tag value (number or enum name) for the given tag. */
export function tagValue(tag: number, s: string): number {
  const c = s.charCodeAt(0);
  if ((c >= 48 && c <= 57) || c === 45) {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  const e = VALUE_ENUMS[tag];
  if (e) {
    const v = e[s];
    if (v !== undefined) return v;
  }
  for (const en of ALL_VALUE_ENUMS) {
    const v = en[s];
    if (v !== undefined) return v;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Entity refs
// ---------------------------------------------------------------------------

const BRACKET_RE =
  /^\[(?:entityName|name)=(.*) id=(\d+) zone=(\w+) zonePos=(-?\d+) cardId=(\S*) player=(\d+)\]$/;
const BRACKET_ID_RE = /(?:^\[|\s)id=(\d+)/;
const BRACKET_CARD_RE = /\scardId=(\S*)/;
const BRACKET_ZONE_RE = /\szone=(\w+)/;
const BRACKET_PLAYER_RE = /\splayer=(\d+)/;

const GAME_REF: EntityRef = Object.freeze({ kind: 'game' }) as EntityRef;

/** Parse an entity reference as printed in the log. */
export function parseEntityRef(raw: string): EntityRef {
  const s = raw.trim();
  if (s === 'GameEntity') return GAME_REF;
  const c = s.charCodeAt(0);
  if (c >= 48 && c <= 57) {
    // bare id (all digits)
    let allDigits = true;
    for (let i = 1; i < s.length; i++) {
      const d = s.charCodeAt(i);
      if (d < 48 || d > 57) {
        allDigits = false;
        break;
      }
    }
    if (allDigits) return { kind: 'id', id: parseInt(s, 10) };
  }
  if (c === 91 /* [ */ && s.charCodeAt(s.length - 1) === 93 /* ] */) {
    const m = BRACKET_RE.exec(s);
    if (m) {
      return {
        kind: 'id',
        name: m[1],
        id: parseInt(m[2], 10),
        zone: m[3],
        zonePos: parseInt(m[4], 10),
        cardId: m[5] || undefined,
        player: parseInt(m[6], 10),
      };
    }
    // Other bracket formats, e.g. `[id=5 cardId= type=INVALID zone=DECK zonePos=0 player=1]`
    const idm = BRACKET_ID_RE.exec(s);
    if (idm) {
      const ref: EntityRef = { kind: 'id', id: parseInt(idm[1], 10) };
      const cm = BRACKET_CARD_RE.exec(s);
      if (cm && cm[1]) ref.cardId = cm[1];
      const zm = BRACKET_ZONE_RE.exec(s);
      if (zm) ref.zone = zm[1];
      const pm = BRACKET_PLAYER_RE.exec(s);
      if (pm) ref.player = parseInt(pm[1], 10);
      return ref;
    }
  }
  return { kind: 'name', name: s };
}

// ---------------------------------------------------------------------------
// Line regexes
// ---------------------------------------------------------------------------

const TAG_CHANGE_RE = /^TAG_CHANGE Entity=(.*) tag=(\S+) value=(\S*)\s*(DEF CHANGE)?\s*$/;
const TAG_LINE_RE = /^tag=(\S+) value=(\S*)/;
const BLOCK_START_RE =
  /^BLOCK_START BlockType=(\S+) Entity=(.*?) EffectCardId=(.*?)(?: EffectIndex=(-?\d+))? Target=(.*?)(?: SubOption=(-?\d+))?(?: TriggerKeyword=(\S+))?\s*$/;
const FULL_ENTITY_RE = /^FULL_ENTITY - (?:Creating|Updating) (?:ID=(\d+)|(\[.*\])) CardID=(\S*)\s*$/;
const SHOW_ENTITY_RE = /^SHOW_ENTITY - Updating Entity=(.*) CardID=(\S*)\s*$/;
const CHANGE_ENTITY_RE = /^CHANGE_ENTITY - Updating Entity=(.*) CardID=(\S*)\s*$/;
const HIDE_ENTITY_RE = /^HIDE_ENTITY - Entity=(.*) tag=(\S+) value=(\S+)\s*$/;
const META_DATA_RE = /^META_DATA - Meta=(\S+) Data=(-?\d+)(?: InfoCount=(\d+))?/;
const INFO_RE = /^Info\[(\d+)\] = (.*)$/;
const SUB_SPELL_START_RE = /^SUB_SPELL_START - SpellPrefabGUID=(\S*) Source=(\S*)(?: TargetCount=(\d+))?/;
const SUB_SPELL_SOURCE_RE = /^Source = (.*)$/;
const SUB_SPELL_TARGET_RE = /^Targets\[(\d+)\] = (.*)$/;
const GAME_ENTITY_RE = /^GameEntity EntityID=(\d+)/;
const PLAYER_RE = /^Player EntityID=(\d+) PlayerID=(\d+) GameAccountId=\[hi=(\d+) lo=(\d+)\]/;
const CHOICES_RE =
  /^id=(\d+) (?:Player|PlayerId)=(.*?)(?: TaskList=(\d*))? ChoiceType=(\w+) CountMin=(\d+) CountMax=(\d+)/;
const CHOICE_SOURCE_RE = /^Source=(.*)$/;
const CHOICE_ENTITY_RE = /^Entities\[(\d+)\]=(.*)$/;
const CHOSEN_RE = /^id=(\d+) (?:Player|PlayerId)=(.*?) EntitiesCount=(\d+)/;
const GAME_INFO_PLAYER_RE = /^PlayerID=(\d+), PlayerName=(.*)$/;

function enumValue(e: Record<string, number>, s: string): number {
  const c = s.charCodeAt(0);
  if ((c >= 48 && c <= 57) || c === 45) return parseInt(s, 10);
  return e[s] ?? 0;
}

type Pending =
  | { kind: 'entity'; packet: GameEntityPacket | PlayerPacket | FullEntityPacket | ShowEntityPacket | ChangeEntityPacket }
  | { kind: 'meta'; packet: MetaDataPacket }
  | { kind: 'subspell'; packet: SubSpellStartPacket }
  | { kind: 'choices'; packet: EntityChoicesPacket }
  | { kind: 'chosen'; packet: EntitiesChosenPacket };

export interface ParserOptions {
  /** Force a source instead of auto-detecting it from the first CREATE_GAME. */
  source?: LogSource;
}

export class PowerLogParser {
  private pending: Pending | null = null;
  private activeSource: LogSource | undefined;
  private readonly forcedSource: LogSource | undefined;
  /** Number of lines seen. */
  lineCount = 0;

  constructor(opts: ParserOptions = {}) {
    this.forcedSource = opts.source;
    this.activeSource = opts.source;
  }

  get source(): LogSource | undefined {
    return this.activeSource;
  }

  reset(): void {
    this.pending = null;
    this.activeSource = this.forcedSource;
    this.lineCount = 0;
  }

  /** Emit any buffered multi-line packet. */
  flush(out: Packet[] = []): Packet[] {
    if (this.pending) {
      out.push(this.pending.packet);
      this.pending = null;
    }
    return out;
  }

  /** Parse one line. Returns the packets completed by this line (often none or one). */
  feedLine(line: string, out: Packet[] = []): Packet[] {
    this.lineCount++;
    let len = line.length;
    // strip trailing \r / \n
    while (len > 0) {
      const ch = line.charCodeAt(len - 1);
      if (ch === 13 || ch === 10) len--;
      else break;
    }
    if (len !== line.length) line = line.slice(0, len);
    if (len < 8) return out;

    // Prefix: "D 13:18:11.0621247 " (level letter + timestamp). Also tolerate "[Power] ".
    let pos = 0;
    let ts = '';
    const c0 = line.charCodeAt(0);
    if ((c0 === 68 || c0 === 73 || c0 === 87 || c0 === 69) && line.charCodeAt(1) === 32) {
      const sp = line.indexOf(' ', 2);
      if (sp < 0) return out;
      ts = line.slice(2, sp);
      pos = sp + 1;
    } else if (line.startsWith('[Power] ')) {
      pos = 8;
    }
    const sep = line.indexOf('() - ', pos);
    let method: string;
    let payloadStart: number;
    if (sep < 0) {
      if (line.endsWith('() -')) {
        method = line.slice(pos, line.length - 2);
        payloadStart = line.length;
      } else return out;
    } else {
      method = line.slice(pos, sep + 2);
      payloadStart = sep + 5;
    }

    switch (method) {
      case 'GameState.DebugPrintPower()':
        return this.powerLine(line, payloadStart, 'GameState', ts, out);
      case 'PowerTaskList.DebugPrintPower()':
        return this.powerLine(line, payloadStart, 'PowerTaskList', ts, out);
      case 'GameState.DebugPrintEntityChoices()':
        return this.choicesLine(line.slice(payloadStart).trim(), ts, out);
      case 'GameState.DebugPrintEntitiesChosen()':
        return this.chosenLine(line.slice(payloadStart).trim(), ts, out);
      case 'GameState.DebugPrintGame()':
        this.flush(out);
        out.push(this.gameInfo(line.slice(payloadStart).trim(), ts));
        return out;
      default:
        // DebugPrintOptions, SendOption, SendChoices, DebugPrintPowerList, DebugDump, ...
        // Only flush for GameState lines of the active source family; unrelated
        // PowerTaskList/PowerProcessor chatter never splits a GameState packet.
        if (method.startsWith('GameState.')) {
          if (this.pending && (this.pending.kind === 'choices' || this.pending.kind === 'chosen')) this.flush(out);
          else if (this.activeSource !== 'PowerTaskList') this.flush(out);
        }
        return out;
    }
  }

  private gameInfo(p: string, ts: string): GameInfoPacket {
    const eq = p.indexOf('=');
    const k = eq >= 0 ? p.slice(0, eq) : p;
    const v = eq >= 0 ? p.slice(eq + 1) : '';
    if (k === 'PlayerID') {
      const m = GAME_INFO_PLAYER_RE.exec(p);
      if (m) return { type: 'GameInfo', ts, key: 'Player', value: p, playerId: parseInt(m[1], 10), playerName: m[2] };
    }
    if (k === 'BuildNumber' || k === 'GameType' || k === 'FormatType' || k === 'ScenarioID') {
      return { type: 'GameInfo', ts, key: k, value: v.trim() };
    }
    return { type: 'GameInfo', ts, key: 'Other', value: p };
  }

  private choicesLine(p: string, ts: string, out: Packet[]): Packet[] {
    const pend = this.pending;
    if (pend && pend.kind === 'choices') {
      let m = CHOICE_ENTITY_RE.exec(p);
      if (m) {
        pend.packet.entities.push(parseEntityRef(m[2]));
        return out;
      }
      m = CHOICE_SOURCE_RE.exec(p);
      if (m) {
        pend.packet.source = parseEntityRef(m[1]);
        return out;
      }
    }
    this.flush(out);
    const m = CHOICES_RE.exec(p);
    if (m) {
      this.pending = {
        kind: 'choices',
        packet: {
          type: 'EntityChoices',
          ts,
          choiceId: parseInt(m[1], 10),
          player: parseEntityRef(m[2]),
          taskList: m[3] ? parseInt(m[3], 10) : undefined,
          choiceType: enumValue(ChoiceType, m[4]),
          countMin: parseInt(m[5], 10),
          countMax: parseInt(m[6], 10),
          entities: [],
        },
      };
    }
    return out;
  }

  private chosenLine(p: string, ts: string, out: Packet[]): Packet[] {
    const pend = this.pending;
    if (pend && pend.kind === 'chosen') {
      const m = CHOICE_ENTITY_RE.exec(p);
      if (m) {
        pend.packet.entities.push(parseEntityRef(m[2]));
        return out;
      }
    }
    this.flush(out);
    const m = CHOSEN_RE.exec(p);
    if (m) {
      this.pending = {
        kind: 'chosen',
        packet: { type: 'EntitiesChosen', ts, choiceId: parseInt(m[1], 10), player: parseEntityRef(m[2]), entities: [] },
      };
    }
    return out;
  }

  private powerLine(line: string, start: number, source: LogSource, ts: string, out: Packet[]): Packet[] {
    // skip indentation
    let i = start;
    while (i < line.length && line.charCodeAt(i) === 32) i++;
    const p = line.slice(i);

    if (this.activeSource !== source) {
      if (this.activeSource === undefined && p.startsWith('CREATE_GAME')) {
        this.activeSource = source;
      } else return out;
    }

    const c = p.charCodeAt(0);
    const pend = this.pending;

    // Child lines of the pending packet.
    if (pend) {
      if (c === 116 /* t */ && pend.kind === 'entity') {
        const m = TAG_LINE_RE.exec(p);
        if (m) {
          const t = tagId(m[1]);
          pend.packet.tags.push([t, tagValue(t, m[2])]);
          return out;
        }
      } else if (c === 73 /* I */ && pend.kind === 'meta') {
        const m = INFO_RE.exec(p);
        if (m) {
          pend.packet.info.push(parseEntityRef(m[2]));
          return out;
        }
      } else if (pend.kind === 'subspell') {
        if (c === 83 /* S */) {
          const m = SUB_SPELL_SOURCE_RE.exec(p);
          if (m) {
            pend.packet.source = parseEntityRef(m[1]);
            return out;
          }
        } else if (c === 84 /* T */) {
          const m = SUB_SPELL_TARGET_RE.exec(p);
          if (m) {
            pend.packet.targets.push(parseEntityRef(m[2]));
            return out;
          }
        }
      }
      out.push(pend.packet);
      this.pending = null;
    }

    switch (c) {
      case 84: {
        // TAG_CHANGE
        if (p.startsWith('TAG_CHANGE ')) {
          const m = TAG_CHANGE_RE.exec(p);
          if (m) {
            const t = tagId(m[2]);
            const pk: TagChangePacket = { type: 'TagChange', ts, entity: parseEntityRef(m[1]), tag: t, value: tagValue(t, m[3]) };
            if (m[4]) pk.def = true;
            out.push(pk);
          }
        }
        return out;
      }
      case 66: {
        // BLOCK_START / BLOCK_END
        if (p.startsWith('BLOCK_END')) {
          out.push({ type: 'BlockEnd', ts });
        } else if (p.startsWith('BLOCK_START')) {
          const m = BLOCK_START_RE.exec(p);
          if (m) {
            const target = m[5] ? parseEntityRef(m[5]) : undefined;
            out.push({
              type: 'BlockStart',
              ts,
              blockType: enumValue(BlockType, m[1]),
              entity: parseEntityRef(m[2]),
              effectCardId: m[3],
              effectIndex: m[4] ? parseInt(m[4], 10) : 0,
              target: target && !(target.kind === 'id' && target.id === 0) ? target : undefined,
              subOption: m[6] ? parseInt(m[6], 10) : -1,
              triggerKeyword: m[7],
            });
          }
        }
        return out;
      }
      case 70: {
        if (p.startsWith('FULL_ENTITY')) {
          const m = FULL_ENTITY_RE.exec(p);
          if (m) {
            const id = m[1] ? parseInt(m[1], 10) : (parseEntityRef(m[2]).id ?? 0);
            this.pending = { kind: 'entity', packet: { type: 'FullEntity', ts, id, cardId: m[3], tags: [] } };
          }
        }
        return out;
      }
      case 83: {
        if (p.startsWith('SHOW_ENTITY')) {
          const m = SHOW_ENTITY_RE.exec(p);
          if (m) this.pending = { kind: 'entity', packet: { type: 'ShowEntity', ts, entity: parseEntityRef(m[1]), cardId: m[2], tags: [] } };
        } else if (p.startsWith('SUB_SPELL_START')) {
          const m = SUB_SPELL_START_RE.exec(p);
          if (m) {
            const src = m[2] ? parseEntityRef(m[2]) : undefined;
            this.pending = { kind: 'subspell', packet: { type: 'SubSpellStart', ts, prefab: m[1], source: src, targets: [] } };
          }
        } else if (p.startsWith('SUB_SPELL_END')) {
          out.push({ type: 'SubSpellEnd', ts });
        }
        return out;
      }
      case 72: {
        if (p.startsWith('HIDE_ENTITY')) {
          const m = HIDE_ENTITY_RE.exec(p);
          if (m) {
            const t = tagId(m[2]);
            out.push({ type: 'HideEntity', ts, entity: parseEntityRef(m[1]), zone: tagValue(t, m[3]) });
          }
        }
        return out;
      }
      case 67: {
        if (p.startsWith('CHANGE_ENTITY')) {
          const m = CHANGE_ENTITY_RE.exec(p);
          if (m) this.pending = { kind: 'entity', packet: { type: 'ChangeEntity', ts, entity: parseEntityRef(m[1]), cardId: m[2], tags: [] } };
        } else if (p.startsWith('CREATE_GAME')) {
          out.push({ type: 'CreateGame', ts, source });
        }
        return out;
      }
      case 77: {
        if (p.startsWith('META_DATA')) {
          const m = META_DATA_RE.exec(p);
          if (m) {
            this.pending = {
              kind: 'meta',
              packet: { type: 'MetaData', ts, meta: enumValue(MetaDataType, m[1]), data: parseInt(m[2], 10), info: [] },
            };
          }
        }
        return out;
      }
      case 71: {
        if (p.startsWith('GameEntity')) {
          const m = GAME_ENTITY_RE.exec(p);
          if (m) this.pending = { kind: 'entity', packet: { type: 'GameEntity', ts, id: parseInt(m[1], 10), tags: [] } };
        }
        return out;
      }
      case 80: {
        if (p.startsWith('Player ')) {
          const m = PLAYER_RE.exec(p);
          if (m) {
            this.pending = {
              kind: 'entity',
              packet: {
                type: 'Player',
                ts,
                id: parseInt(m[1], 10),
                playerId: parseInt(m[2], 10),
                accountHi: m[3],
                accountLo: m[4],
                tags: [],
              },
            };
          }
        }
        return out;
      }
      default:
        return out;
    }
  }
}

/** Convenience: parse a whole log text (or array of lines) into packets. */
export function parsePowerLog(text: string | string[], opts?: ParserOptions): Packet[] {
  const p = new PowerLogParser(opts);
  const out: Packet[] = [];
  const lines = typeof text === 'string' ? text.split('\n') : text;
  for (const l of lines) p.feedLine(l, out);
  p.flush(out);
  return out;
}
