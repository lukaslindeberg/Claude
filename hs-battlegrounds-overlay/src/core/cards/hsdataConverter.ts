/**
 * Converts HearthSim hsdata files (CardDefs.Bacon.xml + RaceTagMap.xml) into the
 * compact `BgCardData` format used by the app.
 *
 * Pure TypeScript, no dependencies, works in Node and in the browser. Used both by
 * the build script (scripts/build-card-data.ts) and by the Electron main process
 * to refresh card data at runtime after a Hearthstone patch.
 */
import type { BgCard, BgCardData, BgCardType, Tribe } from '@shared/types';

export const HSDATA_BASE_URL = 'https://raw.githubusercontent.com/HearthSim/hsdata/master';
export const HSDATA_BACON_URL = `${HSDATA_BASE_URL}/CardDefs.Bacon.xml`;
export const HSDATA_RACETAGMAP_URL = `${HSDATA_BASE_URL}/RaceTagMap.xml`;

/** Race enum value -> tribe (only the tribes that exist in Battlegrounds). */
const RACE_BY_ID: Record<number, Tribe> = {
  11: 'UNDEAD',
  14: 'MURLOC',
  15: 'DEMON',
  17: 'MECHANICAL',
  18: 'ELEMENTAL',
  20: 'BEAST',
  23: 'PIRATE',
  24: 'DRAGON',
  26: 'ALL',
  43: 'QUILBOAR',
  92: 'NAGA',
  126: 'ABERRATION',
};
const BG_TRIBES = new Set<string>(Object.values(RACE_BY_ID));

const CARDTYPE: Record<number, BgCardType> = {
  3: 'HERO',
  4: 'MINION',
  5: 'SPELL',
  6: 'ENCHANTMENT',
  10: 'HERO_POWER',
  40: 'REWARD',
  42: 'SPELL',
  43: 'ANOMALY',
  44: 'TRINKET',
};

/** Int tags with value 1 that are surfaced as `mechanics`. */
const MECHANIC_TAGS = new Set([
  'TAUNT',
  'DIVINE_SHIELD',
  'DEATHRATTLE',
  'START_OF_COMBAT',
  'AVENGE',
  'BATTLECRY',
  'MAGNETIC',
  'REBORN',
  'WINDFURY',
  'MEGA_WINDFURY',
  'VENOMOUS',
  'POISONOUS',
  'STEALTH',
  'CLEAVE',
  'OVERKILL',
  'CHOOSE_ONE',
  'DISCOVER',
  'TRIGGER_VISUAL',
  'END_OF_TURN_TRIGGER',
  'AURA',
  'IMMUNE',
  'SECRET',
  'QUEST',
  'BACON_RALLY',
  'BACON_TIMEWARPED',
  'BACON_BUDDY',
  'BACON_BLOOD_GEM_TOOLTIP',
  'BACON_TRIGGER_XY',
  'BACON_TRIGGER_UPBEAT',
  'BACON_REBORN_TOOLTIP',
  'BACON_FODDER',
  'BACON_OLD_GOD',
  'HAS_DARK_GIFT',
  'DARK_GIFT',
  'IS_BACON_DUOS_EXCLUSIVE',
  'ELITE',
  'SPELLPOWER',
  'MODULAR',
  'FREEZE',
  'CANT_ATTACK',
  'ZERG',
  'PROTOSS',
  'TERRAN',
]);

/** Numeric tags copied verbatim into `card.tags` for the simulator. */
const NUMERIC_TAGS = new Set([
  'TAG_SCRIPT_DATA_NUM_1',
  'TAG_SCRIPT_DATA_NUM_2',
  'TAG_SCRIPT_DATA_NUM_3',
  'TAG_SCRIPT_DATA_NUM_4',
  'TAG_SCRIPT_DATA_NUM_5',
  'TAG_SCRIPT_DATA_NUM_6',
  'BACON_SPELLCRAFT_ID',
  'BACON_EVOLUTION_CARD_ID',
  'QUEST_PROGRESS_TOTAL',
  'BACON_TURNS_TILL_ACTIVE',
  'MAGNETIC_TO_RACE',
  'BACON_HEROPOWER_BASE_HERO_ID',
  'SPELL_SCHOOL',
  'WINDFURY',
]);

interface RawEntity {
  cardId: string;
  dbfId: number;
  ints: Map<string, number>;
  intsById: Map<number, number>;
  cardRefs: Map<string, string>; // tag name -> referenced cardID (type="Card")
  name?: string;
  text?: string;
}

const ENTITY_RE = /<Entity CardID="([^"]+)" ID="(\d+)"[^>]*>([\s\S]*?)<\/Entity>/g;
const INT_TAG_RE = /<Tag (?:cardID="([^"]*)" )?enumID="(\d+)" name="([^"]*)" type="(Int|Card|Bool)" value="(-?\d+)"\s*\/>/g;
const LOC_RE = /<Tag enumID="(\d+)" name="(CARDNAME|CARDTEXT)" type="LocString">([\s\S]*?)<\/Tag>/g;

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function locValue(body: string, locale: string): string | undefined {
  const m = new RegExp(`<${locale}>([\\s\\S]*?)</${locale}>`).exec(body);
  return m ? decodeXml(m[1]) : undefined;
}

/**
 * Hearthstone card text -> light HTML.
 * Handles [x] layout markers, $/# number markers, {0}/{1}/@ script-data placeholders,
 * |4(singular, plural) plural forms and line breaks.
 */
export function cleanCardText(raw: string | undefined, tags?: Map<string, number>): string | undefined {
  if (!raw) return undefined;
  const sd1 = tags?.get('TAG_SCRIPT_DATA_NUM_1');
  const sd2 = tags?.get('TAG_SCRIPT_DATA_NUM_2');
  let t = raw
    .replace(/^\[x\]/, '')
    .replace(/[$#](\d+)/g, '$1')
    .replace(/\{0\}/g, sd1 !== undefined ? String(sd1) : 'X')
    .replace(/\{1\}/g, sd2 !== undefined ? String(sd2) : 'X')
    .replace(/\{\d+\}/g, 'X')
    .replace(/@/g, sd1 !== undefined ? String(sd1) : 'X')
    .replace(/(\d+|X)(\s*)\|4\(([^,()]*),\s*([^()]*)\)/g, (_m, n, sp, one, many) => `${n}${sp}${n === '1' ? one : many}`)
    .replace(/\|4\(([^,()]*),\s*([^()]*)\)/g, '$2')
    .replace(/_/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // allow only <b>, <i>, <br> tags
  t = t.replace(/<(?!\/?(b|i|br)\b)[^>]*>/g, '');
  return t || undefined;
}

const TRIBE_WORDS: [RegExp, Tribe][] = [
  [/\bBeasts?\b/, 'BEAST'],
  [/\bDemons?\b/, 'DEMON'],
  [/\bDragons?\b/, 'DRAGON'],
  [/\bElementals?\b/, 'ELEMENTAL'],
  [/\bMech(?:s|anicals?)?\b/, 'MECHANICAL'],
  [/\bMurlocs?\b/, 'MURLOC'],
  [/\bNagas?\b/, 'NAGA'],
  [/\bPirates?\b/, 'PIRATE'],
  [/\bQuilboars?\b/, 'QUILBOAR'],
  [/\bUndeads?\b/, 'UNDEAD'],
  [/\bAberrations?\b/, 'ABERRATION'],
];
/** LOBBY_TRIBES order (not imported: scripts/build-card-data.ts runs this file without path aliases). */
const TRIBE_ORDER = TRIBE_WORDS.map(([, t]) => t).sort();
/** Card types whose text is scanned for `relatedTribes`. */
const RELATED_TRIBE_TYPES = new Set<BgCardType>(['HERO', 'HERO_POWER', 'TRINKET', 'REWARD', 'QUEST', 'SPELL', 'MINION']);

/**
 * Tribes a card's text names ("Beasts", "a Mech", "Undead"...), in LOBBY_TRIBES order.
 * Tribe-agnostic wording ("of any type", "of each type", "all minion types") adds nothing.
 */
export function relatedTribesFromText(text: string | undefined): Tribe[] {
  if (!text) return [];
  const t = text.replace(/<[^>]*>/g, ' ');
  const found = new Set<Tribe>();
  for (const [re, tribe] of TRIBE_WORDS) if (re.test(t)) found.add(tribe);
  return TRIBE_ORDER.filter((x) => found.has(x));
}

export function parseRaceTagMap(xml: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /<Race race="(\w+)" tag="(\d+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.set(Number(m[2]), m[1]);
  return out;
}

function parseEntities(xml: string, locale: string): RawEntity[] {
  const out: RawEntity[] = [];
  let m: RegExpExecArray | null;
  ENTITY_RE.lastIndex = 0;
  while ((m = ENTITY_RE.exec(xml))) {
    const body = m[3];
    const e: RawEntity = {
      cardId: m[1],
      dbfId: Number(m[2]),
      ints: new Map(),
      intsById: new Map(),
      cardRefs: new Map(),
    };
    let t: RegExpExecArray | null;
    INT_TAG_RE.lastIndex = 0;
    while ((t = INT_TAG_RE.exec(body))) {
      const [, refCardId, enumId, name, type, value] = t;
      const v = Number(value);
      e.intsById.set(Number(enumId), v);
      if (name && !/^\d+$/.test(name)) e.ints.set(name, v);
      if (type === 'Card' && refCardId) e.cardRefs.set(name, refCardId);
    }
    LOC_RE.lastIndex = 0;
    while ((t = LOC_RE.exec(body))) {
      const val = locValue(t[3], locale) ?? locValue(t[3], 'enUS');
      if (t[2] === 'CARDNAME') e.name = val;
      else e.text = val;
    }
    out.push(e);
  }
  return out;
}

function readBuild(xml: string): number {
  const m = /<CardDefs build="(\d+)"/.exec(xml);
  return m ? Number(m[1]) : 0;
}

export interface ConvertOptions {
  locale?: string;
  patch?: string;
  /** Include enchantments (minimal fields). Default true. */
  includeEnchantments?: boolean;
}

export function convertHsData(baconXml: string, raceTagMapXml: string, opts: ConvertOptions = {}): BgCardData {
  const locale = opts.locale ?? 'enUS';
  const raceTags = parseRaceTagMap(raceTagMapXml);
  const raw = parseEntities(baconXml, locale);
  const byDbf = new Map<number, RawEntity>();
  for (const e of raw) byDbf.set(e.dbfId, e);
  const idOfDbf = (dbf: number | undefined): string | undefined =>
    dbf ? byDbf.get(dbf)?.cardId : undefined;

  const cards: BgCard[] = [];
  for (const e of raw) {
    const cardTypeId = e.ints.get('CARDTYPE') ?? 0;
    let type: BgCardType = CARDTYPE[cardTypeId] ?? 'OTHER';
    if (type === 'SPELL' && e.ints.get('QUEST')) type = 'QUEST';
    if (cardTypeId === 24) type = 'MINION'; // BATTLEGROUND_HERO_BUDDY

    if (type === 'ENCHANTMENT' && opts.includeEnchantments === false) continue;

    const tribes = new Set<Tribe>();
    const race = e.ints.get('CARDRACE');
    if (race && RACE_BY_ID[race]) tribes.add(RACE_BY_ID[race]);
    for (const [tagId, raceName] of raceTags) {
      if ((e.intsById.get(tagId) ?? 0) > 0 && BG_TRIBES.has(raceName)) tribes.add(raceName as Tribe);
    }
    if (tribes.has('ALL') && tribes.size > 1) {
      tribes.clear();
      tribes.add('ALL');
    }

    const card: BgCard = {
      id: e.cardId,
      dbfId: e.dbfId,
      name: e.name ?? e.cardId,
      type,
      tribes: [...tribes],
      mechanics: [],
      pool: (e.ints.get('IS_BACON_POOL_MINION') ?? 0) > 0 || (e.ints.get('IS_BACON_POOL_SPELL') ?? 0) > 0,
    };

    if (type === 'ENCHANTMENT') {
      // keep enchantments light: they're only used to label effects and by the simulator
      const sd1 = e.ints.get('TAG_SCRIPT_DATA_NUM_1');
      const sd2 = e.ints.get('TAG_SCRIPT_DATA_NUM_2');
      if (sd1 !== undefined || sd2 !== undefined) {
        card.tags = {};
        if (sd1 !== undefined) card.tags.TAG_SCRIPT_DATA_NUM_1 = sd1;
        if (sd2 !== undefined) card.tags.TAG_SCRIPT_DATA_NUM_2 = sd2;
      }
      const dr = e.ints.get('DEATHRATTLE');
      if (dr) card.mechanics.push('DEATHRATTLE');
      cards.push(card);
      continue;
    }

    const text = cleanCardText(e.text, e.ints);
    if (text) card.text = text;
    const tier = e.ints.get('TECH_LEVEL');
    if (tier) card.tier = tier;
    if (type === 'MINION' || type === 'HERO') {
      card.attack = e.ints.get('ATK') ?? 0;
      card.health = e.ints.get('HEALTH') ?? 0;
    }
    const cost = e.ints.get('COST');
    if (cost !== undefined) card.cost = cost;
    const armor = e.ints.get('ARMOR');
    if (type === 'HERO' && armor) card.armor = armor;

    for (const [name, v] of e.ints) {
      if (v > 0 && MECHANIC_TAGS.has(name)) card.mechanics.push(name);
    }
    if ((e.ints.get('WINDFURY') ?? 0) >= 3) card.mechanics.push('MEGA_WINDFURY');
    if ((e.ints.get('BACON_SPELLCRAFT_ID') ?? 0) > 0) card.mechanics.push('SPELLCRAFT');
    card.mechanics.sort();

    const tags: Record<string, number> = {};
    for (const [name, v] of e.ints) if (NUMERIC_TAGS.has(name)) tags[name] = v;
    if (Object.keys(tags).length) card.tags = tags;

    if (e.ints.get('PREMIUM')) card.golden = true;
    const goldenId = idOfDbf(e.ints.get('BACON_TRIPLE_UPGRADE_MINION_ID'));
    if (goldenId) card.goldenId = goldenId;
    const normalId = idOfDbf(e.ints.get('BACON_TRIPLED_BASE_MINION_ID'));
    if (normalId) {
      card.normalId = normalId;
      card.golden = true;
    }
    const hp = e.cardRefs.get('HERO_POWER');
    if (hp) card.heroPowerId = hp;
    const buddy = idOfDbf(e.ints.get('BACON_COMPANION_ID'));
    if (buddy) card.buddyId = buddy;
    const skinParent = idOfDbf(e.ints.get('BACON_SKIN_PARENT_ID'));
    if (skinParent && skinParent !== card.id) card.skinParentId = skinParent;
    if (e.ints.get('BACON_TIMEWARPED')) card.timewarped = true;
    if (e.ints.get('IS_BACON_DUOS_EXCLUSIVE')) card.duosOnly = true;
    if (type === 'HERO' && e.ints.get('BACON_HERO_CAN_BE_DRAFTED')) card.mechanics.push('BACON_HERO_CAN_BE_DRAFTED');

    cards.push(card);
  }

  // Golden versions inherit pool status / tier from their base for convenience.
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const c of cards) {
    if (!RELATED_TRIBE_TYPES.has(c.type)) continue;
    const rel = relatedTribesFromText(c.text);
    if (rel.length) c.relatedTribes = rel;
  }
  // A hero needs what its hero power needs.
  for (const c of cards) {
    if (c.type !== 'HERO' || !c.heroPowerId) continue;
    const hp = byId.get(c.heroPowerId)?.relatedTribes;
    if (!hp?.length) continue;
    const all = new Set([...(c.relatedTribes ?? []), ...hp]);
    c.relatedTribes = TRIBE_ORDER.filter((x) => all.has(x));
  }
  for (const c of cards) {
    if (c.normalId) {
      const base = byId.get(c.normalId);
      if (base) {
        if (!c.tier && base.tier) c.tier = base.tier;
        if (!base.goldenId) base.goldenId = c.id;
        if (!c.tribes.length && base.tribes.length) c.tribes = base.tribes;
      }
    }
  }

  return {
    build: readBuild(baconXml),
    patch: opts.patch,
    generatedAt: new Date().toISOString(),
    source: 'hsdata',
    locale,
    cards,
  };
}
