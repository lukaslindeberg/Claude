/**
 * Minion construction: from tracker snapshots, from card ids (tokens), copies
 * and Reborn copies.
 */
import type { BgCard, MinionSnapshot, Tribe } from '@shared/types';
import { getEnchantmentHandler, getMinionHandler } from '../cards/registry';
import type { Battle, Minion, SideState } from './types';

const EMPTY_TAGS: Record<string, number> = Object.freeze({}) as Record<string, number>;

function hasMech(card: BgCard | undefined, mech: string): boolean {
  return !!card && card.mechanics.includes(mech);
}

export function hasTribe(m: { tribes: readonly Tribe[] }, tribe: Tribe): boolean {
  const t = m.tribes;
  for (let i = 0; i < t.length; i++) if (t[i] === tribe || t[i] === 'ALL') return true;
  return false;
}

/** Minions with no tribe (for "minions with no type" effects). */
export function hasNoTribe(m: { tribes: readonly Tribe[] }): boolean {
  return m.tribes.length === 0;
}

function blankMinion(b: Battle, side: SideState): Minion {
  return {
    entityId: 0,
    cardId: '',
    name: '',
    golden: false,
    mult: 1,
    tier: 1,
    tribes: [],
    attack: 0,
    health: 1,
    maxHealth: 1,
    taunt: false,
    divineShield: false,
    venomous: false,
    poisonous: false,
    windfury: false,
    megaWindfury: false,
    reborn: false,
    stealth: false,
    cleave: false,
    destroyed: false,
    removed: false,
    side,
    handler: undefined,
    extraDeathrattles: [],
    enchantments: [],
    avengeProgress: 0,
    counters: null,
    tags: EMPTY_TAGS,
    killedBy: null,
    auraAttack: 0,
    auraHealth: 0,
    isDeity: false,
    snapshot: null,
    stash: null,
  };
}

function attachEnchantments(b: Battle, m: Minion, ids: readonly string[]): void {
  for (const id of ids) {
    const h = getEnchantmentHandler(id);
    if (!h) continue;
    if (h.deathrattle) m.extraDeathrattles.push({ sourceCardId: id, golden: false, fn: h.deathrattle });
    h.init?.(b, m);
  }
}

/** Build a combat minion from a tracker snapshot (stats already include all buffs). */
export function minionFromSnapshot(b: Battle, side: SideState, s: MinionSnapshot): Minion {
  const card = b.db.get(s.cardId);
  const m = blankMinion(b, side);
  const t = s.tags ?? EMPTY_TAGS;
  const k = s.keywords ?? {};
  m.entityId = s.entityId || b.nextEntityId++;
  m.cardId = s.cardId;
  m.name = s.name || card?.name || s.cardId;
  m.golden = !!s.golden || !!card?.golden || (t.PREMIUM ?? 0) > 0;
  m.mult = m.golden ? 2 : 1;
  m.tier = s.tier ?? b.db.tier(s.cardId) ?? t.TECH_LEVEL ?? 1;
  if (!m.tier || m.tier < 1) m.tier = 1;
  m.tribes = s.tribes && s.tribes.length ? s.tribes : (card?.tribes ?? []);
  m.attack = Math.max(0, s.attack | 0);
  m.maxHealth = Math.max(1, (s.maxHealth || s.health) | 0);
  m.health = s.health | 0;
  if (m.health <= 0) m.health = 1; // a minion on the board at combat start is alive
  m.taunt = !!(k.taunt || t.TAUNT);
  m.divineShield = !!(k.divineShield || t.DIVINE_SHIELD);
  m.venomous = !!(k.venomous || t.VENOMOUS);
  m.poisonous = !!(k.poisonous || t.POISONOUS || t.NON_KEYWORD_POISONOUS);
  m.megaWindfury = !!(k.megaWindfury || t.MEGA_WINDFURY || (t.WINDFURY ?? 0) >= 3);
  m.windfury = !m.megaWindfury && !!(k.windfury || t.WINDFURY);
  m.reborn = !!(k.reborn || t.REBORN);
  m.stealth = !!(k.stealth || t.STEALTH);
  m.cleave = !!(k.cleave || t.CLEAVE);
  m.tags = t;
  m.snapshot = s;
  m.enchantments = s.enchantments ? s.enchantments.map((e) => e.cardId) : [];
  m.handler = getMinionHandler(s.cardId, b.db);
  m.handler?.init?.(b, m);
  if (m.enchantments.length) attachEnchantments(b, m, m.enchantments);
  return m;
}

export interface TokenOptions {
  golden?: boolean;
  attack?: number;
  health?: number;
  tribes?: Tribe[];
  name?: string;
  tier?: number;
  taunt?: boolean;
  divineShield?: boolean;
  reborn?: boolean;
  venomous?: boolean;
  windfury?: boolean;
}

/**
 * Build a fresh minion from its card definition (tokens, summons, Reborn copies).
 * Unknown card ids produce a vanilla minion using the given options.
 * Applies player-level "this game" bonuses (Undead attack) and the handler's `init`.
 */
export function minionFromCard(b: Battle, side: SideState, cardId: string, opts: TokenOptions = {}): Minion {
  let id = cardId;
  if (opts.golden) {
    const g = b.db.goldenOf(cardId);
    if (g) id = g;
  }
  const card = b.db.get(id);
  const m = blankMinion(b, side);
  m.entityId = b.nextEntityId++;
  m.cardId = id;
  m.name = opts.name ?? card?.name ?? id;
  m.golden = !!opts.golden || !!card?.golden;
  m.mult = m.golden ? 2 : 1;
  m.tier = opts.tier ?? card?.tier ?? b.db.tier(id) ?? 1;
  if (!m.tier || m.tier < 1) m.tier = 1;
  m.tribes = opts.tribes ?? card?.tribes ?? [];
  m.attack = opts.attack ?? card?.attack ?? 1;
  m.health = m.maxHealth = Math.max(1, opts.health ?? card?.health ?? 1);
  m.taunt = opts.taunt ?? hasMech(card, 'TAUNT');
  m.divineShield = opts.divineShield ?? hasMech(card, 'DIVINE_SHIELD');
  m.venomous = opts.venomous ?? hasMech(card, 'VENOMOUS');
  m.poisonous = hasMech(card, 'POISONOUS');
  m.megaWindfury = hasMech(card, 'MEGA_WINDFURY');
  m.windfury = !m.megaWindfury && (opts.windfury ?? hasMech(card, 'WINDFURY'));
  m.reborn = opts.reborn ?? hasMech(card, 'REBORN');
  m.stealth = hasMech(card, 'STEALTH');
  m.cleave = hasMech(card, 'CLEAVE');
  m.tags = (card?.tags as Record<string, number> | undefined) ?? EMPTY_TAGS;
  if (side.undeadAttackBonus && hasTribe(m, 'UNDEAD')) m.attack += side.undeadAttackBonus;
  m.handler = getMinionHandler(id, b.db);
  m.handler?.init?.(b, m);
  return m;
}

/** "Summon a copy": same card, current stats and keywords, granted deathrattles. */
export function copyMinion(b: Battle, src: Minion, side: SideState = src.side): Minion {
  const m: Minion = {
    ...src,
    entityId: b.nextEntityId++,
    side,
    tribes: src.tribes,
    extraDeathrattles: src.extraDeathrattles.slice(),
    enchantments: src.enchantments.slice(),
    counters: src.counters ? { ...src.counters } : null,
    destroyed: false,
    removed: false,
    killedBy: null,
    avengeProgress: 0,
    auraAttack: 0,
    auraHealth: 0,
    isDeity: false,
    stash: src.stash ? src.stash.slice() : null,
  };
  // Aura bonuses are not copied (they are recomputed for the copy).
  m.attack = Math.max(0, src.attack - src.auraAttack);
  m.maxHealth = Math.max(1, src.maxHealth - src.auraHealth);
  m.health = Math.max(1, Math.min(src.health, m.maxHealth));
  // No handler `init`: the copy already carries the source's flags and "this game" bonuses.
  return m;
}

/** `Minion.counters` key: "This is Reborn with full Health and enchantments" (Timewarped Hag). */
export const FULL_REBORN = 'fullReborn';

/** The minion a Reborn minion comes back as: base card, 1 Health, no Reborn. */
export function rebornCopy(b: Battle, dead: Minion): Minion {
  const card = b.db.get(dead.cardId);
  if (dead.counters?.[FULL_REBORN]) {
    // Keeps its stats, keywords and granted deathrattles; comes back at full Health.
    const full = copyMinion(b, dead);
    full.health = full.maxHealth;
    full.reborn = false;
    if (hasMech(card, 'DIVINE_SHIELD')) full.divineShield = true;
    if (hasMech(card, 'VENOMOUS')) full.venomous = true;
    return full;
  }
  const m = minionFromCard(b, dead.side, dead.cardId, {
    golden: false, // cardId is already the golden id when golden
    tribes: card?.tribes?.length ? card.tribes : dead.tribes,
    attack: card?.attack ?? dead.attack,
    health: card?.health ?? dead.maxHealth,
    tier: dead.tier,
    name: dead.name,
  });
  m.golden = dead.golden;
  m.mult = dead.mult;
  m.health = 1;
  m.reborn = false;
  // Sim-added keywords that the base card normally has are already set by minionFromCard.
  return m;
}

export function cardTier(b: Battle, cardId: string): number {
  return b.db.tier(cardId) ?? 1;
}
