/**
 * Convert an HSReplay XML replay into Power.log text (GameState.DebugPrintPower() format),
 * so XML replays can be used as tracker fixtures.
 *
 * Usage:
 *   node --experimental-strip-types scripts/hsreplay-xml-to-log.ts <replay.xml> [out.power.log[.gz]]
 *
 * Without an output path the log is written to stdout. A `.gz` output is gzipped.
 *
 * The output mimics the real client log:
 *  - `D HH:MM:SS.fffffff GameState.DebugPrintPower() - ` prefix, 4 spaces per block depth
 *  - players referenced by name (BG dummy player: the XML name; DebugPrintGame prints "The Innkeeper")
 *  - bracketed entity refs `[entityName=X id=N zone=Z zonePos=P cardId=C player=Q]` showing the
 *    entity state BEFORE the change, bare ids for entities created in the current top-level block
 *  - enum-valued tags printed by name (ZONE value=PLAY, CARDTYPE value=HERO, ...)
 *  - DebugPrintGame(), DebugPrintEntityChoices(), SendChoices(), DebugPrintEntitiesChosen(),
 *    DebugPrintOptions() header lines.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BlockType_BY_ID,
  CardClass_BY_ID,
  CardType_BY_ID,
  ChoiceType_BY_ID,
  FormatType_BY_ID,
  GameTag,
  GameTag_BY_ID,
  GameType_BY_ID,
  MetaDataType_BY_ID,
  Mulligan_BY_ID,
  PlayState_BY_ID,
  Race_BY_ID,
  State_BY_ID,
  Step_BY_ID,
  Zone_BY_ID,
} from '../src/core/log/enums.ts';

const FACTION_BY_ID: Record<number, string> = { 0: 'INVALID', 1: 'HORDE', 2: 'ALLIANCE', 3: 'NEUTRAL' };
const RARITY_BY_ID: Record<number, string> = { 0: 'INVALID', 1: 'COMMON', 2: 'FREE', 3: 'RARE', 4: 'EPIC', 5: 'LEGENDARY' };

const VALUE_NAMES: Record<number, Record<number, string>> = {
  [GameTag.ZONE]: Zone_BY_ID,
  [GameTag.CARDTYPE]: CardType_BY_ID,
  [GameTag.STEP]: Step_BY_ID,
  [GameTag.NEXT_STEP]: Step_BY_ID,
  [GameTag.PLAYSTATE]: PlayState_BY_ID,
  [GameTag.STATE]: State_BY_ID,
  [GameTag.MULLIGAN_STATE]: Mulligan_BY_ID,
  [GameTag.CARDRACE]: Race_BY_ID,
  [GameTag.CLASS]: CardClass_BY_ID,
  [GameTag.FACTION]: FACTION_BY_ID,
  [GameTag.RARITY]: RARITY_BY_ID,
};

// Tags the real client printed by number at the time (its enum lacked them). We print every tag we
// know by name, except a few that the client is known to print numerically - keeps both paths tested.
const PRINT_NUMERIC = new Set<number>([1068, 1037, 479, 1196, 1254, 1200, 1429, 937, 2053]);

function tagStr(tag: number): string {
  if (PRINT_NUMERIC.has(tag)) return String(tag);
  return GameTag_BY_ID[tag] ?? String(tag);
}
function valueStr(tag: number, value: number): string {
  const names = VALUE_NAMES[tag];
  if (names) {
    const n = names[value];
    if (n !== undefined) return n;
  }
  return String(value);
}

function decodeXml(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, g: string) => {
    if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[g];
  });
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s))) out[m[1]] = decodeXml(m[2]);
  return out;
}

interface Ent {
  id: number;
  cardId: string;
  name?: string;
  tags: Map<number, number>;
  /** Block sequence (top-level block counter) in which it was created. */
  createdIn: number;
}

interface PlayerEnt {
  id: number;
  playerID: number;
  name: string;
  hi: string;
  lo: string;
}

function loadCardNames(): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const data = JSON.parse(readFileSync(resolve(here, '../src/core/cards/data/bg-cards.json'), 'utf8')) as {
      cards: { id: string; name: string }[];
    };
    for (const c of data.cards) names.set(c.id, c.name);
  } catch {
    // card names are optional
  }
  return names;
}

function tsFromIso(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback;
  const m = /T(\d\d:\d\d:\d\d)(?:\.(\d+))?/.exec(iso);
  if (!m) return fallback;
  const frac = ((m[2] ?? '') + '0000000').slice(0, 7);
  return `${m[1]}.${frac}`;
}

export function convertXmlToLog(xml: string, cardNames: Map<string, string> = loadCardNames()): string[] {
  const out: string[] = [];
  const ents = new Map<number, Ent>();
  const players = new Map<number, PlayerEnt>();
  let gameEntityId = 0;
  let ts = '00:00:00.0000000';
  let depth = 0; // block depth (also bumped by SubSpell)
  let topBlockSeq = 0;
  let gameAttrs: Record<string, string> = {};
  let build = '';
  let printedGameInfo = false;
  let localPlayerName = '';

  const power = (indent: number, s: string) => out.push(`D ${ts} GameState.DebugPrintPower() - ${' '.repeat(indent)}${s}`);
  const gs = (method: string, s: string) => out.push(`D ${ts} GameState.${method}() - ${s}`);

  const entityName = (e: Ent): string => {
    if (!e.cardId) return 'UNKNOWN ENTITY [cardType=INVALID]';
    return e.name ?? cardNames.get(e.cardId) ?? e.cardId;
  };

  const ref = (id: number, allowBare = true): string => {
    if (id === gameEntityId) return 'GameEntity';
    const p = players.get(id);
    if (p) return p.name;
    const e = ents.get(id);
    if (!e) return String(id);
    if (allowBare && e.createdIn === topBlockSeq && depth > 0) return String(id);
    const zone = Zone_BY_ID[e.tags.get(GameTag.ZONE) ?? 0] ?? 'INVALID';
    const zonePos = e.tags.get(GameTag.ZONE_POSITION) ?? 0;
    const controller = e.tags.get(GameTag.CONTROLLER) ?? 0;
    return `[entityName=${entityName(e)} id=${id} zone=${zone} zonePos=${zonePos} cardId=${e.cardId} player=${controller}]`;
  };

  const ensureEnt = (id: number): Ent => {
    let e = ents.get(id);
    if (!e) {
      e = { id, cardId: '', tags: new Map(), createdIn: -1 };
      ents.set(id, e);
    }
    return e;
  };

  const printGameInfo = () => {
    if (printedGameInfo) return;
    printedGameInfo = true;
    const gt = gameAttrs.type ? (GameType_BY_ID[+gameAttrs.type] ?? gameAttrs.type) : inferGameType();
    const ft = gameAttrs.format ? (FormatType_BY_ID[+gameAttrs.format] ?? gameAttrs.format) : 'FT_WILD';
    const scenario = gameAttrs.scenarioID ?? String(ents.get(gameEntityId)?.tags.get(937) ?? 0);
    if (build) gs('DebugPrintGame', `BuildNumber=${build}`);
    gs('DebugPrintGame', `GameType=${gt}`);
    gs('DebugPrintGame', `FormatType=${ft}`);
    gs('DebugPrintGame', `ScenarioID=${scenario}`);
    for (const p of players.values()) {
      const isDummy = ents.get(p.id)?.tags.get(GameTag.BACON_DUMMY_PLAYER) === 1;
      gs('DebugPrintGame', `PlayerID=${p.playerID}, PlayerName=${isDummy ? 'The Innkeeper' : p.name}`);
    }
  };
  const inferGameType = (): string => {
    const scen = ents.get(gameEntityId)?.tags.get(937);
    let duo = scen === 5173;
    for (const p of players.values()) if (ents.get(p.id)?.tags.get(GameTag.BACON_DUO_TEAMMATE_PLAYER_ID)) duo = true;
    const bg = scen === 3459 || scen === 5173 || [...players.values()].some((p) => ents.get(p.id)?.tags.get(GameTag.BACON_DUMMY_PLAYER) === 1);
    if (!bg) return 'GT_UNKNOWN';
    return duo ? 'GT_BATTLEGROUNDS_DUO' : 'GT_BATTLEGROUNDS';
  };

  type Frame =
    | { kind: 'GameEntity' | 'Player'; id: number; tags: [number, number][]; attrs: Record<string, string> }
    | { kind: 'FullEntity' | 'ShowEntity' | 'ChangeEntity'; id: number; cardId: string; name?: string; tags: [number, number][]; header: string; indent: number }
    | { kind: 'Block' }
    | { kind: 'SubSpell'; indent: number }
    | { kind: 'MetaData'; indent: number; header: string; info: number[] }
    | { kind: 'Choices'; attrs: Record<string, string>; choices: number[] }
    | { kind: 'ChosenEntities'; attrs: Record<string, string>; choices: number[] }
    | { kind: 'SendChoices'; attrs: Record<string, string>; choices: number[] }
    | { kind: 'Options' }
    | { kind: 'Other'; name: string };
  const stack: Frame[] = [];

  const flushEntityFrame = (f: Extract<Frame, { kind: 'FullEntity' | 'ShowEntity' | 'ChangeEntity' }>) => {
    // header was already printed at open; print tags now and apply them.
    const e = ensureEnt(f.id);
    for (const [t, v] of f.tags) power(f.indent + 4, `tag=${tagStr(t)} value=${valueStr(t, v)}`);
    if (f.kind === 'FullEntity') {
      e.tags.clear();
      e.createdIn = depth > 0 ? topBlockSeq : -1;
    }
    if (f.cardId) e.cardId = f.cardId;
    if (f.name) e.name = f.name;
    for (const [t, v] of f.tags) e.tags.set(t, v);
  };

  const playerName = (attrs: Record<string, string>, isLocalGuess: boolean): string => {
    if (attrs.name) return attrs.name;
    if (isLocalGuess) return `Player${attrs.playerID}#${(+attrs.accountLo % 9000) + 1000}`;
    return 'Bartender Bob';
  };

  const TOKEN_RE = /<(\/?)([A-Za-z]+)((?:\s+[A-Za-z_:][\w:.-]*="[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(xml))) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosing = m[4] === '/';
    const attrs = closing ? {} : parseAttrs(m[3]);
    if (!closing && attrs.ts) ts = tsFromIso(attrs.ts, ts);

    if (!closing) {
      // A child element of an entity frame that is not a Tag ends the tag list (e.g. nested elements).
      const top = stack[stack.length - 1];
      switch (name) {
        case 'HSReplay':
          build = attrs.build ?? '';
          break;
        case 'Game':
          gameAttrs = attrs;
          ents.clear();
          players.clear();
          printedGameInfo = false;
          depth = 0;
          power(0, 'CREATE_GAME');
          break;
        case 'GameEntity': {
          gameEntityId = +attrs.id;
          power(4, `GameEntity EntityID=${attrs.id}`);
          stack.push({ kind: 'GameEntity', id: +attrs.id, tags: [], attrs });
          break;
        }
        case 'Player': {
          const id = +attrs.id;
          const isLocalGuess = (attrs.accountHi ?? '0') !== '0';
          const pname = playerName(attrs, isLocalGuess);
          if (isLocalGuess) localPlayerName = pname;
          players.set(id, { id, playerID: +attrs.playerID, name: pname, hi: attrs.accountHi ?? '0', lo: attrs.accountLo ?? '0' });
          power(4, `Player EntityID=${id} PlayerID=${attrs.playerID} GameAccountId=[hi=${attrs.accountHi ?? 0} lo=${attrs.accountLo ?? 0}]`);
          stack.push({ kind: 'Player', id, tags: [], attrs });
          break;
        }
        case 'Tag': {
          if (top && 'tags' in top) top.tags.push([+attrs.tag, +attrs.value]);
          break;
        }
        case 'FullEntity':
        case 'ShowEntity':
        case 'ChangeEntity': {
          if (name === 'FullEntity' && !printedGameInfo && players.size > 0) printGameInfo();
          const id = +(attrs.id ?? attrs.entity);
          const cardId = attrs.cardID ?? '';
          const indent = depth * 4;
          if (name === 'FullEntity') power(indent, `FULL_ENTITY - Creating ID=${id} CardID=${cardId}`);
          else if (name === 'ShowEntity') power(indent, `SHOW_ENTITY - Updating Entity=${ref(id)} CardID=${cardId}`);
          else power(indent, `CHANGE_ENTITY - Updating Entity=${ref(id)} CardID=${cardId}`);
          const f: Frame = { kind: name, id, cardId, name: attrs.EntityName, tags: [], header: '', indent };
          if (selfClosing) flushEntityFrame(f);
          else stack.push(f);
          break;
        }
        case 'HideEntity': {
          const id = +attrs.entity;
          const zone = +attrs.zone;
          power(depth * 4, `HIDE_ENTITY - Entity=${ref(id)} tag=ZONE value=${Zone_BY_ID[zone] ?? zone}`);
          ensureEnt(id).tags.set(GameTag.ZONE, zone);
          break;
        }
        case 'TagChange': {
          if (!printedGameInfo && players.size > 0) printGameInfo();
          const id = +attrs.entity;
          const tag = +attrs.tag;
          const value = +attrs.value;
          const def = attrs.hasChangeDef === 'True' || attrs.hasChangeDef === 'true' || attrs.hasChangeDef === '1';
          power(depth * 4, `TAG_CHANGE Entity=${ref(id)} tag=${tagStr(tag)} value=${valueStr(tag, value)} ${def ? 'DEF CHANGE' : ''}`);
          if (!players.has(id)) ensureEnt(id).tags.set(tag, value);
          else ensureEnt(id).tags.set(tag, value);
          break;
        }
        case 'Block': {
          if (!printedGameInfo && players.size > 0) printGameInfo();
          if (depth === 0) topBlockSeq++;
          const bt = +attrs.type;
          const btName = BlockType_BY_ID[bt] ?? String(bt);
          const target = attrs.target && attrs.target !== '0' ? ref(+attrs.target) : '0';
          const kw = attrs.triggerKeyword ? tagStr(+attrs.triggerKeyword) : 'TAG_NOT_SET';
          const tail = bt === 5 ? ` TriggerKeyword=${kw}` : ' ';
          power(
            depth * 4,
            `BLOCK_START BlockType=${btName} Entity=${ref(+attrs.entity)} EffectCardId=${attrs.effectCardId ?? ''} EffectIndex=${attrs.effectIndex ?? 0} Target=${target} SubOption=${attrs.subOption ?? -1}${tail}`,
          );
          depth++;
          if (selfClosing) {
            depth--;
            power(depth * 4, 'BLOCK_END');
          } else stack.push({ kind: 'Block' });
          break;
        }
        case 'MetaData': {
          const meta = MetaDataType_BY_ID[+attrs.meta] ?? attrs.meta;
          const f: Frame = { kind: 'MetaData', indent: depth * 4, header: `META_DATA - Meta=${meta} Data=${attrs.data ?? 0} InfoCount=${attrs.infoCount ?? 0}`, info: [] };
          if (selfClosing) power(f.indent, f.header);
          else stack.push(f);
          break;
        }
        case 'Info': {
          if (top && top.kind === 'MetaData') top.info.push(+attrs.entity);
          break;
        }
        case 'SubSpell': {
          const indent = depth * 4;
          const src = attrs.source ? +attrs.source : 0;
          power(indent, `SUB_SPELL_START - SpellPrefabGUID=${attrs.spellPrefabGuid ?? ''} Source=${src} TargetCount=${attrs.targetCount ?? 0}`);
          if (src) power(indent + 18, `Source = ${ref(src)}`);
          depth++;
          if (selfClosing) {
            depth--;
            power(indent, 'SUB_SPELL_END');
          } else stack.push({ kind: 'SubSpell', indent });
          break;
        }
        case 'SubSpellTarget': {
          const ss = [...stack].reverse().find((f) => f.kind === 'SubSpell') as { indent: number } | undefined;
          power((ss?.indent ?? depth * 4) + 18, `Targets[${attrs.index}] = ${ref(+attrs.entity)}`);
          break;
        }
        case 'Choices': {
          const f: Frame = { kind: 'Choices', attrs, choices: [] };
          stack.push(f);
          if (selfClosing) closeFrame();
          break;
        }
        case 'ChosenEntities':
        case 'SendChoices': {
          const f: Frame = { kind: name, attrs, choices: [] };
          stack.push(f);
          if (selfClosing) closeFrame();
          break;
        }
        case 'Choice': {
          if (top && (top.kind === 'Choices' || top.kind === 'ChosenEntities' || top.kind === 'SendChoices')) top.choices.push(+attrs.entity);
          break;
        }
        case 'Options': {
          gs('DebugPrintOptions', `id=${attrs.id}`);
          if (!selfClosing) stack.push({ kind: 'Options' });
          break;
        }
        case 'SendOption': {
          gs('SendOption', `selectedOption=${attrs.option} selectedSubOption=${attrs.subOption ?? -1} selectedTarget=${attrs.target ?? 0} selectedPosition=${attrs.position ?? 0}`);
          break;
        }
        default:
          if (!selfClosing) stack.push({ kind: 'Other', name });
      }
      // Entity frames: Tag children only. Any other element nested inside closes the tag list early.
      void top;
    } else {
      closeFrame(name);
    }
  }

  function closeFrame(name?: string): void {
    const f = stack.pop();
    if (!f) return;
    switch (f.kind) {
      case 'GameEntity':
      case 'Player': {
        for (const [t, v] of f.tags) power(8, `tag=${tagStr(t)} value=${valueStr(t, v)}`);
        const e = ensureEnt(f.id);
        if (f.kind === 'GameEntity') e.cardId = 'GameEntity';
        for (const [t, v] of f.tags) e.tags.set(t, v);
        break;
      }
      case 'FullEntity':
      case 'ShowEntity':
      case 'ChangeEntity':
        flushEntityFrame(f);
        break;
      case 'Block':
        depth--;
        power(depth * 4, 'BLOCK_END');
        break;
      case 'SubSpell':
        depth--;
        power(f.indent, 'SUB_SPELL_END');
        break;
      case 'MetaData':
        power(f.indent, f.header);
        for (let i = 0; i < f.info.length; i++) power(f.indent + 12, `Info[${i}] = ${ref(f.info[i])}`);
        break;
      case 'Choices': {
        const a = f.attrs;
        const pname = players.get(+a.entity)?.name ?? localPlayerName;
        const ct = ChoiceType_BY_ID[+a.type] ?? a.type;
        gs('DebugPrintEntityChoices', `id=${a.id} Player=${pname} TaskList=${a.taskList ?? ''} ChoiceType=${ct} CountMin=${a.min ?? 0} CountMax=${a.max ?? 0}`);
        gs('DebugPrintEntityChoices', `  Source=${a.source ? ref(+a.source, false) : 'GameEntity'}`);
        f.choices.forEach((id, i) => gs('DebugPrintEntityChoices', `  Entities[${i}]=${ref(id, false)}`));
        break;
      }
      case 'SendChoices': {
        const ct = ChoiceType_BY_ID[+f.attrs.type] ?? f.attrs.type;
        gs('SendChoices', `id=${f.attrs.id} ChoiceType=${ct}`);
        f.choices.forEach((id, i) => gs('SendChoices', `  m_chosenEntities[${i}]=${ref(id, false)}`));
        break;
      }
      case 'ChosenEntities': {
        const pname = players.get(+f.attrs.entity)?.name ?? localPlayerName;
        gs('DebugPrintEntitiesChosen', `id=${f.attrs.id} Player=${pname} EntitiesCount=${f.choices.length}`);
        f.choices.forEach((id, i) => gs('DebugPrintEntitiesChosen', `  Entities[${i}]=${ref(id, false)}`));
        break;
      }
      default:
        void name;
    }
  }

  return out;
}

// CLI
const isMain = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node --experimental-strip-types scripts/hsreplay-xml-to-log.ts <replay.xml> [out.power.log[.gz]]');
    process.exit(1);
  }
  const lines = convertXmlToLog(readFileSync(input, 'utf8'));
  const text = lines.join('\n') + '\n';
  if (!output) process.stdout.write(text);
  else if (output.endsWith('.gz')) writeFileSync(output, gzipSync(text, { level: 9 }));
  else writeFileSync(output, text);
  if (output) console.error(`wrote ${lines.length} lines to ${output}`);
}
