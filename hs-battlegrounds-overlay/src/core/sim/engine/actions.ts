/**
 * Primitive game actions used by the engine and by card handlers:
 * stat changes, keywords, damage, destroy, summon, Blood Gems, spells, Deity.
 */
import type { Tribe } from '@shared/types';
import { recalcAuras } from './auras';
import { aliveCount, aliveMinions, anchorIndex, endAnchor, insertAt, isAlive } from './board';
import { emitDamageDealt, emitDivineShieldLost, emitSpellCast, emitSummon, guarded } from './events';
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
  if (source && !source.removed) emitDamageDealt(b, source, target, amount);
  return { dealt: amount, killed, excess: killed ? Math.max(0, amount - Math.max(0, before)) : 0 };
}

export function destroy(b: Battle, m: Minion, source: Minion | null = null): void {
  if (m.removed || m.destroyed) return;
  m.destroyed = true;
  if (!m.killedBy) m.killedBy = source;
  void b;
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
    m.attack += sb.attack;
    m.health += sb.health;
    m.maxHealth += sb.health;
    if (sb.taunt) m.taunt = true;
  }
  if (b.hasAuras || m.handler?.aura) {
    if (m.handler?.aura) b.hasAuras = true;
    recalcAuras(b);
  }
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

/** Play `count` Blood Gems on `target` (respects the side's Blood Gem values). */
export function playBloodGem(b: Battle, target: Minion, count = 1): void {
  for (let i = 0; i < count; i++) {
    if (target.removed) return;
    const side = target.side;
    const ok = guarded(b, () => {
      buff(b, target, side.bloodGemAttack, side.bloodGemHealth);
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
