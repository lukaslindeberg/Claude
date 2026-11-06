/**
 * Helpers turning store entities into the plain-JSON snapshot shapes of the
 * shared contract (MinionSnapshot, ShopOffer, ...).
 */
import type { EnchantmentSnapshot, MinionKeywords, MinionSnapshot, ShopOffer, Tribe } from '@shared/types';
import type { CardDb } from '../cards/cardDb';
import { CardType, GameTag as T, Race_BY_ID, Zone } from '../log/enums';
import { tagName } from '../log/powerLogParser';
import type { Entity, EntityStore } from '../game/entityStore';

const BG_TRIBES = new Set<Tribe>([
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
]);

/** BACON_SUBSET_* tag -> tribe (pool sub-sets a pool minion belongs to). */
export const SUBSET_TAG_TRIBE: Array<[number, Tribe]> = [
  [T.BACON_SUBSET_DRAGON, 'DRAGON'],
  [T.BACON_SUBSET_MURLOC, 'MURLOC'],
  [T.BACON_SUBSET_DEMON, 'DEMON'],
  [T.BACON_SUBSET_BEAST, 'BEAST'],
  [T.BACON_SUBSET_MECH, 'MECHANICAL'],
  [T.BACON_SUBSET_PIRATE, 'PIRATE'],
  [T.BACON_SUBSET_ELEMENTALS, 'ELEMENTAL'],
  [T.BACON_SUBSET_QUILLBOAR, 'QUILBOAR'],
  [T.BACON_SUBSET_NAGA, 'NAGA'],
  [T.BACON_SUBSET_UNDEAD, 'UNDEAD'],
  [T.BACON_SUBSET_ABERRATION, 'ABERRATION'],
];

/** CARDRACE value -> Tribe (BEAST/PET share id 20). */
export function raceToTribe(race: number): Tribe | undefined {
  if (race === 26) return 'ALL';
  const name = Race_BY_ID[race];
  if (name === 'PET') return 'BEAST';
  return name && BG_TRIBES.has(name as Tribe) ? (name as Tribe) : undefined;
}

export function tribesOf(e: Entity, db: CardDb): Tribe[] {
  const card = db.get(e.cardId);
  if (card) return card.tribes;
  const t = raceToTribe(e.tags.get(T.CARDRACE) ?? 0);
  return t ? [t] : [];
}

/**
 * Tribe a shop-offered minion proves to be in the lobby, from the log's own data:
 *  - BACON_SUBSET_* tags (pool sub-sets the card belongs to; dual-tribe minions carry two,
 *    some neutrals carry one, e.g. Nadina the Red -> DRAGON): exactly one => that tribe.
 *  - logs without subset tags (very old): the single CARDRACE.
 * The card DB is deliberately NOT used: cards get re-tagged between patches.
 * Returns undefined if inconclusive (neutral, multi-tribe).
 */
export function lobbyTribeEvidence(e: Entity, _db?: CardDb): Tribe | undefined {
  if ((e.tags.get(T.CARDTYPE) ?? 0) !== CardType.MINION) return undefined;
  let subset: Tribe | undefined;
  let n = 0;
  for (const [tag, tribe] of SUBSET_TAG_TRIBE) {
    if ((e.tags.get(tag) ?? 0) > 0) {
      subset = tribe;
      n++;
    }
  }
  if (n === 1) return subset;
  if (n > 1) return undefined;
  if ((e.tags.get(T.BACON_SUBSET_ALL) ?? 0) > 0) return undefined;
  const t = raceToTribe(e.tags.get(T.CARDRACE) ?? 0);
  return t && t !== 'ALL' ? t : undefined;
}

export function tagsRecord(e: Entity): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of e.tags) out[tagName(k)] = v;
  return out;
}

export function displayName(e: Entity, db: CardDb): string {
  const c = db.get(e.cardId);
  if (c) return c.name;
  if (e.name && !e.name.startsWith('UNKNOWN ENTITY')) return e.name;
  return e.cardId;
}

function keywordsOf(e: Entity, db: CardDb): MinionKeywords {
  const g = (t: number) => (e.tags.get(t) ?? 0) > 0;
  const k: MinionKeywords = {};
  if (g(T.TAUNT)) k.taunt = true;
  if (g(T.DIVINE_SHIELD)) k.divineShield = true;
  if (g(T.POISONOUS)) k.poisonous = true;
  if (g(T.VENOMOUS)) k.venomous = true;
  if (g(T.MEGA_WINDFURY) || (e.tags.get(T.WINDFURY) ?? 0) >= 3) k.megaWindfury = true;
  else if (g(T.WINDFURY)) k.windfury = true;
  if (g(T.REBORN)) k.reborn = true;
  if (g(T.STEALTH)) k.stealth = true;
  if (g(T.DEATHRATTLE)) k.deathrattle = true;
  if (g(T.START_OF_COMBAT)) k.startOfCombat = true;
  if (g(T.AVENGE)) k.avenge = true;
  if (g(T.MAGNETIC)) k.magnetic = true;
  const card = db.get(e.cardId);
  if (card?.mechanics.includes('CLEAVE')) k.cleave = true;
  return k;
}

/** Index of enchantments (in PLAY or SETASIDE) by the entity they are attached to. */
export function enchantmentIndex(store: EntityStore): Map<number, Entity[]> {
  const idx = new Map<number, Entity[]>();
  for (const e of store.entities.values()) {
    if (e.tags.get(T.CARDTYPE) !== CardType.ENCHANTMENT) continue;
    const att = e.tags.get(T.ATTACHED);
    if (!att) continue;
    const z = e.tags.get(T.ZONE) ?? 0;
    if (z !== Zone.PLAY && z !== Zone.SETASIDE) continue;
    let l = idx.get(att);
    if (!l) idx.set(att, (l = []));
    l.push(e);
  }
  return idx;
}

export function minionSnapshot(
  e: Entity,
  store: EntityStore,
  db: CardDb,
  enchants: Map<number, Entity[]>,
  position?: number,
): MinionSnapshot {
  const card = db.get(e.cardId);
  const health = e.tags.get(T.HEALTH) ?? card?.health ?? 0;
  const enchantments: EnchantmentSnapshot[] = (enchants.get(e.id) ?? []).map((en) => {
    const s: EnchantmentSnapshot = { entityId: en.id, cardId: en.cardId };
    const creator = store.get(en.tags.get(T.CREATOR));
    if (creator?.cardId && creator.cardId !== 'GameEntity') s.creatorCardId = creator.cardId;
    const sd1 = en.tags.get(T.TAG_SCRIPT_DATA_NUM_1);
    const sd2 = en.tags.get(T.TAG_SCRIPT_DATA_NUM_2);
    if (sd1 !== undefined) s.scriptData1 = sd1;
    if (sd2 !== undefined) s.scriptData2 = sd2;
    return s;
  });
  const tier = e.tags.get(T.TECH_LEVEL) || db.tier(e.cardId);
  return {
    entityId: e.id,
    cardId: e.cardId,
    name: displayName(e, db),
    attack: e.tags.get(T.ATK) ?? card?.attack ?? 0,
    health: health - (e.tags.get(T.DAMAGE) ?? 0),
    maxHealth: health,
    golden: (e.tags.get(T.PREMIUM) ?? 0) > 0 || !!card?.golden,
    tier: tier || undefined,
    tribes: tribesOf(e, db),
    position: position ?? e.tags.get(T.ZONE_POSITION) ?? 0,
    keywords: keywordsOf(e, db),
    enchantments,
    tags: tagsRecord(e),
  };
}

export function shopOffer(e: Entity, db: CardDb): ShopOffer {
  const card = db.get(e.cardId);
  const ct = e.tags.get(T.CARDTYPE) ?? 0;
  const health = e.tags.get(T.HEALTH) ?? card?.health ?? 0;
  return {
    entityId: e.id,
    cardId: e.cardId,
    name: displayName(e, db),
    tier: e.tags.get(T.TECH_LEVEL) || db.tier(e.cardId) || undefined,
    tribes: tribesOf(e, db),
    attack: e.tags.get(T.ATK) ?? card?.attack ?? 0,
    health: health - (e.tags.get(T.DAMAGE) ?? 0),
    golden: (e.tags.get(T.PREMIUM) ?? 0) > 0 || !!card?.golden,
    type: ct === CardType.MINION ? 'MINION' : ct === CardType.BATTLEGROUND_SPELL || ct === CardType.SPELL ? 'SPELL' : 'OTHER',
  };
}

/** Most represented tribes on a board (>= 2 minions), most frequent first. */
export function mainTribes(minions: MinionSnapshot[]): Tribe[] {
  const counts = new Map<Tribe, number>();
  for (const m of minions) {
    const ts = m.tribes.includes('ALL') ? [] : m.tribes;
    for (const t of ts) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const main = sorted.filter(([, n]) => n >= 2).map(([t]) => t);
  if (main.length) return main;
  return sorted.length ? [sorted[0][0]] : [];
}
