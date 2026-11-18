/**
 * Primitive game actions used by the engine and by card handlers:
 * stat changes, keywords, damage, destroy, summon, Blood Gems, spells, Deity.
 */
import { LOBBY_TRIBES, type Tribe } from '@shared/types';
import { recalcAuras } from './auras';
import { aliveCount, aliveMinions, anchorIndex, endAnchor, insertAt, isAlive } from './board';
import {
  emitAttackGained,
  emitDamageDealt,
  emitDivineShieldLost,
  emitFriendlyDamaged,
  emitSpellCast,
  emitStatsGained,
  emitSummon,
  guarded,
} from './events';
import { hasTribe } from './minion';
import { MAX_BOARD, type Battle, type Minion, type SideState, type SpaceSummon, type SummonAnchor } from './types';

// ---------------------------------------------------------------------------
// Stats & keywords
// ---------------------------------------------------------------------------

/** Give +attack/+health (negative attack allowed, never below 0). */
export function buff(b: Battle, m: Minion, attack: number, health: number): void {
  if (m.removed) return;
  if (attack) {
    m.attack += attack;
    if (m.attack < 0) m.attack = 0;
  }
  if (health) {
    m.health += health;
    m.maxHealth += health;
  }
  if (m.handler?.onStatsChanged) m.handler.onStatsChanged(b, m);
  if (b.watchAttackGain && attack > 0) emitAttackGained(b, m, attack);
  if (b.watchStatGain && (attack > 0 || health > 0)) emitStatsGained(b, m, Math.max(0, attack), Math.max(0, health));
}

/** Set stats ("Set to X/Y"): resets damage. */
export function setStats(b: Battle, m: Minion, attack: number, health: number): void {
  m.attack = Math.max(0, attack);
  m.health = m.maxHealth = Math.max(1, health);
  if (m.handler?.onStatsChanged) m.handler.onStatsChanged(b, m);
}

export function giveDivineShield(b: Battle, m: Minion): void {
  if (m.divineShield || m.removed) return;
  m.divineShield = true;
  m.handler?.onDivineShieldChanged?.(b, m, true);
}

export function loseDivineShield(b: Battle, m: Minion): void {
  if (!m.divineShield) return;
  m.divineShield = false;
  m.handler?.onDivineShieldChanged?.(b, m, false);
  emitDivineShieldLost(b, m);
}

export function giveTaunt(m: Minion): void {
  m.taunt = true;
}

export function giveReborn(m: Minion): void {
  m.reborn = true;
}

export function giveVenomous(m: Minion): void {
  m.venomous = true;
}

export function giveWindfury(m: Minion): void {
  if (!m.megaWindfury) m.windfury = true;
}

// ---------------------------------------------------------------------------
// Damage & destruction
// ---------------------------------------------------------------------------

export interface DamageResult {
  /** Damage actually dealt (0 if absorbed by Divine Shield). */
  dealt: number;
  /** The target went from alive to dead. */
  killed: boolean;
  /** Damage beyond the target's remaining Health. */
  excess: number;
}

/** `Minion.counters` key: extra hits the Divine Shield absorbs before breaking. */
export const SHIELD_HITS = 'extraShieldHits';

const NO_DAMAGE: DamageResult = Object.freeze({ dealt: 0, killed: false, excess: 0 });

/**
 * Deal damage to a minion. `venom` makes the damage destroy the target
 * (Venomous/Poisonous attack damage; Venomous consumption is handled by the caller).
 */
export function dealDamage(
  b: Battle,
  source: Minion | null,
  target: Minion,
  amount: number,
  venom = false,
): DamageResult {
  if (amount <= 0 || target.removed) return NO_DAMAGE;
  if (target.divineShield) {
    // "This minion's Divine Shield takes N hits to break" (counter set by its handler/enchantment).
    const extra = target.counters?.[SHIELD_HITS];
    if (extra && extra > 0) {
      target.counters![SHIELD_HITS] = extra - 1;
      return NO_DAMAGE;
    }
    loseDivineShield(b, target);
    return NO_DAMAGE;
  }
  const wasAlive = isAlive(target);
  const before = target.health;
  target.health -= amount;
  if (venom && target.health > 0) target.destroyed = true;
  const killed = wasAlive && !isAlive(target);
  if (killed && !target.killedBy) target.killedBy = source;
  target.handler?.onDamaged?.(b, target, amount, source);
  if (target.side.effects.length) emitFriendlyDamaged(b, target, amount);
  if (source && !source.removed) emitDamageDealt(b, source, target, amount);
  return { dealt: amount, killed, excess: killed ? Math.max(0, amount - Math.max(0, before)) : 0 };
}

export function destroy(b: Battle, m: Minion, source: Minion | null = null): void {
  if (m.removed || m.destroyed) return;
  m.destroyed = true;
  if (!m.killedBy) m.killedBy = source;
}

// ---------------------------------------------------------------------------
// Summoning
// ---------------------------------------------------------------------------

export function boardFull(side: SideState): boolean {
  return side.board.length >= MAX_BOARD;
}

/**
 * Summon `m` for `side` at `anchor`. Returns false if the board is full.
 * Applies "for the rest of combat" summon buffs and fires summon triggers.
 */
export function summon(b: Battle, side: SideState, m: Minion, anchor: SummonAnchor = endAnchor(side)): boolean {
  if (side.board.length >= MAX_BOARD) return false;
  m.side = side;
  m.removed = false;
  const idx = anchorIndex(anchor);
  insertAt(side, idx, m, anchor);
  const buffs = side.summonBuffs;
  for (let i = 0; i < buffs.length; i++) {
    const sb = buffs[i];
    if (sb.tribe && !hasTribe(m, sb.tribe)) continue;
    if (sb.maxTier !== undefined && m.tier > sb.maxTier) continue;
    m.attack += sb.attack;
    m.health += sb.health;
    m.maxHealth += sb.health;
    if (sb.taunt) m.taunt = true;
  }
  if (b.hasAuras || m.handler?.aura) {
    if (m.handler?.aura) b.hasAuras = true;
    recalcAuras(b);
  }
  if (b.log) b.log.push(`summon ${side.index === 0 ? 'P' : 'O'}:${m.name}#${m.entityId} @${idx}`);
  m.handler?.onSummoned?.(b, m);
  emitSummon(b, m);
  return true;
}

/** Queue a "When you have space, summon ..." effect (resolved after deaths / SoC). */
export function queueSpaceSummon(side: SideState, entry: SpaceSummon): void {
  side.spaceQueue.push(entry);
}

/** Resolve queued "when you have space" summons for both sides. */
export function processSpaceSummons(b: Battle): void {
  for (const side of b.sides) {
    const q = side.spaceQueue;
    while (q.length && side.board.length < MAX_BOARD) {
      const entry = q[0];
      const m = entry.make(b, side);
      if (!m) {
        q.shift();
        continue;
      }
      if (!summon(b, side, m, endAnchor(side))) break;
      entry.remaining--;
      if (entry.remaining <= 0) q.shift();
      entry.after?.(b, m);
    }
  }
}

// ---------------------------------------------------------------------------
// Random selection helpers
// ---------------------------------------------------------------------------

export function randomFriendly(
  b: Battle,
  side: SideState,
  filter?: (m: Minion) => boolean,
  exclude?: Minion | null,
): Minion | undefined {
  const pool = aliveMinions(side).filter((m) => m !== exclude && (!filter || filter(m)));
  return b.rng.pick(pool);
}

export function randomFriendlies(
  b: Battle,
  side: SideState,
  n: number,
  filter?: (m: Minion) => boolean,
  exclude?: Minion | null,
): Minion[] {
  const pool = aliveMinions(side).filter((m) => m !== exclude && (!filter || filter(m)));
  return b.rng.sample(pool, n);
}

export function ofTribe(tribe: Tribe): (m: Minion) => boolean {
  return (m) => hasTribe(m, tribe);
}

export function hasRoom(side: SideState): boolean {
  return aliveCount(side) < MAX_BOARD && side.board.length < MAX_BOARD;
}

// ---------------------------------------------------------------------------
// Blood Gems, spells, Deity
// ---------------------------------------------------------------------------

/** Enchantment holding the stats a minion got from Blood Gems (script data 1/2 = Attack/Health). */
export const BLOOD_GEMS_ENCHANTMENT = 'BG20_GEMe2';
const GEM_ATTACK = 'gemAttack';
const GEM_HEALTH = 'gemHealth';

/**
 * Stats a minion got from Blood Gems ("its Blood Gems": Blood Golem Sticker, Timewarped Bristler):
 * the snapshot's `BG20_GEMe2` enchantments plus the gems played on it in this combat.
 */
export function bloodGemStats(m: Minion): { attack: number; health: number } {
  const c = (m.counters ??= {});
  if (!(GEM_ATTACK in c)) {
    let a = 0;
    let h = 0;
    for (const e of m.snapshot?.enchantments ?? []) {
      if (e.cardId !== BLOOD_GEMS_ENCHANTMENT) continue;
      a += e.scriptData1 ?? 0;
      h += e.scriptData2 ?? 0;
    }
    c[GEM_ATTACK] = a;
    c[GEM_HEALTH] = h;
  }
  return { attack: c[GEM_ATTACK], health: c[GEM_HEALTH] };
}

/** Record Blood Gem stats given to `m` (played gems, or gems handed over by Timewarped Bristler). */
export function addBloodGemStats(m: Minion, attack: number, health: number): void {
  bloodGemStats(m);
  m.counters![GEM_ATTACK] += attack;
  m.counters![GEM_HEALTH] += health;
}

/** Play `count` Blood Gems on `target` (respects the side's Blood Gem values). */
export function playBloodGem(b: Battle, target: Minion, count = 1): void {
  for (let i = 0; i < count; i++) {
    if (target.removed) return;
    const side = target.side;
    const ok = guarded(b, () => {
      buff(b, target, side.bloodGemAttack, side.bloodGemHealth);
      addBloodGemStats(target, side.bloodGemAttack, side.bloodGemHealth);
      target.handler?.onBloodGem?.(b, target);
    });
    if (!ok) return;
  }
}

/** Effects of Tavern spells that can be cast during combat. */
const SPELLS: Record<string, (b: Battle, side: SideState, target: Minion | null) => void> = {
  // Shiny Ring: Give your minions +1/+1.
  BG28_168: (b, side) => {
    const a = 1 + side.spellAttackBonus;
    const h = 1 + side.spellHealthBonus;
    for (const m of aliveMinions(side)) buff(b, m, a, h);
  },
  // Mighty Dragonbreath: Give your minions +3/+2. Repeat for your Dragons. Repeat for your minions with Divine Shield.
  BG36_246: (b, side) => {
    const a = 3 + side.spellAttackBonus;
    const h = 2 + side.spellHealthBonus;
    for (const m of aliveMinions(side)) {
      let times = 1;
      if (hasTribe(m, 'DRAGON')) times++;
      if (m.divineShield) times++;
      buff(b, m, a * times, h * times);
    }
  },
  // Chef's Choice: adds a card to hand (no combat stats).
  BG28_518: () => {},
  // Misplaced Tea Set: Give a friendly minion of each type +3/+3.
  BG28_888: (b, side) => {
    const a = 3 + side.spellAttackBonus;
    const h = 3 + side.spellHealthBonus;
    const used = new Set<Minion>();
    for (const tribe of LOBBY_TRIBES) {
      const pool = aliveMinions(side).filter((m) => !used.has(m) && m.tribes.length > 0 && hasTribe(m, tribe));
      const t = b.rng.pick(pool);
      if (!t) continue;
      used.add(t);
      buff(b, t, a, h);
    }
  },
};

/** Number of times a spell targeting a friendly minion is cast (Balinda Stonehearth). */
function targetedCastCount(side: SideState): number {
  let n = 1;
  for (const m of side.board) {
    if (!isAlive(m)) continue;
    if (m.cardId === 'BG35_883') n += 1;
    else if (m.cardId === 'BG35_883_G') n += 2;
  }
  return n;
}

/** Cast a Tavern spell in combat (effects + "whenever you cast a spell" triggers). */
export function castSpell(b: Battle, side: SideState, spellId: string, target: Minion | null = null): void {
  const casts = target ? targetedCastCount(side) : 1;
  for (let i = 0; i < casts; i++) {
    if (target && !isAlive(target)) return;
    guarded(b, () => {
      SPELLS[spellId]?.(b, side, target);
      emitSpellCast(b, side, spellId, target);
    });
  }
}

/** Give the side's Deity stats (wherever it is: pending or awakened). */
export function giveDeity(b: Battle, side: SideState, attack: number, health: number): void {
  const d = side.deity;
  if (!d) return;
  if (d.minion && !d.minion.removed) buff(b, d.minion, attack, health);
  else if (!d.awakened) {
    d.attack += attack;
    d.health += health;
  }
}

/** "Give your team's Deities +X/+Y" (Duos): this side's Deity and the waiting teammate's. */
export function giveTeamDeities(b: Battle, side: SideState, attack: number, health: number): void {
  giveDeity(b, side, attack, health);
  const t = side.teammate;
  if (t) {
    t.deityAttack = (t.deityAttack ?? 0) + attack;
    t.deityHealth = (t.deityHealth ?? 0) + health;
  }
}
