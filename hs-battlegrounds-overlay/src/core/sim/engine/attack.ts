/**
 * Attacks: attacker selection, target selection, the attack sequence and
 * "attacks immediately" effects.
 *
 * Attack sequence:
 *   1. pick a target (random Taunt, else random non-Stealth, else anything);
 *   2. "whenever this attacks" (Rally) + "whenever a friendly minion attacks" triggers;
 *   3. death phase - if the attacker or target died, the attack fizzles;
 *   4. simultaneous combat damage (+ Cleave on the target's neighbours, Venomous);
 *   5. kill / overkill triggers, "after attack" triggers;
 *   6. death phase.
 */
import { aliveCount, indexOf, isAlive, neighbours } from './board';
import { dealDamage } from './actions';
import { rallyMultiplier, resolveDeaths } from './deaths';
import { emitAfterAttack, emitFriendlyAttack, emitFriendlyAttacked, guarded } from './events';
import type { AttackInfo, Battle, Minion, SideState } from './types';

/** `Minion.counters` key: "Immune while attacking" (takes no combat damage from the minion it attacks). */
export const IMMUNE_WHILE_ATTACKING = 'immuneWhileAttacking';

/** Short label used by the debug log: side:name#entityId. */
export function label(m: Minion): string {
  return `${m.side.index === 0 ? 'P' : 'O'}:${m.name}#${m.entityId}`;
}

export function canAttack(m: Minion): boolean {
  return m.attack > 0 && isAlive(m);
}

/** Select (and point to) the next attacker of a side, or null if none can attack. */
export function nextAttacker(side: SideState): Minion | null {
  const board = side.board;
  const n = board.length;
  if (n === 0) return null;
  let p = side.attackPtr;
  if (p >= n || p < 0) p = 0;
  for (let k = 0; k < n; k++) {
    const i = (p + k) % n;
    const m = board[i];
    if (canAttack(m)) {
      side.attackPtr = i;
      return m;
    }
  }
  return null;
}

export function sideCanAttack(side: SideState): boolean {
  const board = side.board;
  for (let i = 0; i < board.length; i++) if (canAttack(board[i])) return true;
  return false;
}

/** Random Taunt minion, else random non-Stealth minion, else any living minion. */
export function pickTarget(b: Battle, defender: SideState): Minion | null {
  const board = defender.board;
  let taunts: Minion[] | null = null;
  let visible: Minion[] | null = null;
  let any: Minion[] | null = null;
  for (let i = 0; i < board.length; i++) {
    const m = board[i];
    if (!isAlive(m)) continue;
    (any ??= []).push(m);
    if (m.stealth) continue;
    (visible ??= []).push(m);
    if (m.taunt) (taunts ??= []).push(m);
  }
  const pool = taunts ?? visible ?? any;
  return pool ? pool[b.rng.int(pool.length)] : null;
}

export interface AttackOptions {
  /** Regular attack in the side's turn (moves the attack pointer). */
  inTurn: boolean;
  /** Attack this minion instead of a random legal target. */
  forcedTarget?: Minion | null;
}

/** Perform one attack. */
export function doAttack(b: Battle, attacker: Minion, opts: AttackOptions): void {
  if (!canAttack(attacker)) return;
  const side = attacker.side;
  const defender = side.opponent;
  const target = opts.forcedTarget && isAlive(opts.forcedTarget) ? opts.forcedTarget : pickTarget(b, defender);
  if (!target) return;
  b.attacks++;
  if (b.log) b.log.push(`attack ${label(attacker)} -> ${label(target)}${opts.inTurn ? '' : ' (immediate)'}`);
  if (opts.inTurn) {
    side.attackPtr = indexOf(attacker) + 1;
    side.lastAttacker = attacker;
  }
  attacker.stealth = false;

  // "Whenever this attacks" / "Whenever a friendly minion attacks"
  const rally = attacker.handler?.rally;
  if (rally) {
    const times = rallyMultiplier(side);
    for (let i = 0; i < times; i++) guarded(b, () => attacker.handler?.rally?.(b, attacker, target));
  }
  emitFriendlyAttack(b, attacker, target);
  emitFriendlyAttacked(b, attacker, target);
  resolveDeaths(b);
  if (!isAlive(attacker) || !isAlive(target)) {
    if (opts.inTurn) side.lastAttacker = null;
    return;
  }

  // Combat damage (simultaneous)
  const targetIndex = indexOf(target);
  const aAtk = attacker.attack;
  const tAtk = target.attack;
  const aVenom = attacker.venomous || attacker.poisonous;
  const tVenom = target.venomous || target.poisonous;
  const cleaved = attacker.cleave ? neighbours(target) : null;

  const hit = dealDamage(b, attacker, target, aAtk, aVenom);
  let attackerDealt = hit.dealt > 0;
  const cleaveKills: { victim: Minion; excess: number }[] = [];
  if (cleaved) {
    for (const n of cleaved) {
      const r = dealDamage(b, attacker, n, aAtk, aVenom);
      if (r.dealt > 0) attackerDealt = true;
      if (r.killed) cleaveKills.push({ victim: n, excess: r.excess });
    }
  }
  const back = attacker.counters?.[IMMUNE_WHILE_ATTACKING]
    ? { dealt: 0, killed: false, excess: 0 }
    : dealDamage(b, target, attacker, tAtk, tVenom);
  if (attackerDealt && attacker.venomous) attacker.venomous = false;
  if (back.dealt > 0 && target.venomous) target.venomous = false;

  // Kill / overkill triggers
  const onKill = attacker.handler?.onKill;
  if (onKill) {
    if (hit.killed) onKill(b, attacker, target, hit.excess);
    for (const k of cleaveKills) onKill(b, attacker, k.victim, k.excess);
  }
  if (back.killed && target.handler?.onKill) target.handler.onKill(b, target, attacker, back.excess);

  const info: AttackInfo = { attacker, target, killed: hit.killed, excess: hit.excess, targetIndex };
  emitAfterAttack(b, info);
  resolveDeaths(b);
  if (opts.inTurn) side.lastAttacker = null;
}

/** "It attacks immediately": an extra attack outside the normal order. */
export function attackImmediately(b: Battle, m: Minion, target?: Minion | null): void {
  if (!canAttack(m) || aliveCount(m.side.opponent) === 0) return;
  guarded(b, () => doAttack(b, m, { inTurn: false, forcedTarget: target ?? null }));
}

/** One turn of a side: its next attacker attacks (Windfury: 2, Mega-Windfury: 4 times). */
export function takeTurn(b: Battle, side: SideState): boolean {
  const attacker = nextAttacker(side);
  if (!attacker) return false;
  b.activeSide = side.index;
  for (let i = 0; ; i++) {
    const limit = attacker.megaWindfury ? 4 : attacker.windfury ? 2 : 1;
    if (i >= limit) break;
    if (!canAttack(attacker) || aliveCount(side.opponent) === 0) break;
    doAttack(b, attacker, { inTurn: true });
  }
  return true;
}
