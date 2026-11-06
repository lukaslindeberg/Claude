/**
 * Event bus: dispatches combat events to minion handlers (in board order) and
 * side-level effects (hero powers, trinkets, quest rewards, anomalies and
 * temporary listeners) of the relevant side.
 *
 * Listeners must be alive (mortally wounded minions don't trigger). The board is
 * copied before dispatch so handlers may summon/kill freely.
 */
import { LIMITS } from './constants';
import { isAlive } from './board';
import type { AttackInfo, Battle, Minion, SideState } from './types';

function listeners(side: SideState): Minion[] {
  return side.board.slice();
}

export function emitFriendlyAttack(b: Battle, attacker: Minion, target: Minion): void {
  const side = attacker.side;
  for (const m of listeners(side)) {
    if (m.handler?.onFriendlyAttack && isAlive(m)) m.handler.onFriendlyAttack(b, m, attacker, target);
  }
  for (const e of side.effects.slice()) e.handler.onFriendlyAttack?.(b, e, attacker, target);
}

export function emitAfterAttack(b: Battle, info: AttackInfo): void {
  const attacker = info.attacker;
  const side = attacker.side;
  if (attacker.handler?.afterAttack && isAlive(attacker)) attacker.handler.afterAttack(b, attacker, info);
  for (const m of listeners(side)) {
    if (m.handler?.afterFriendlyAttack && isAlive(m)) m.handler.afterFriendlyAttack(b, m, info);
  }
  for (const e of side.effects.slice()) e.handler.afterFriendlyAttack?.(b, e, info);
}

export function emitFriendlyDeath(b: Battle, dead: Minion): void {
  const side = dead.side;
  for (const m of listeners(side)) {
    if (m.handler?.onFriendlyDeath && isAlive(m)) m.handler.onFriendlyDeath(b, m, dead);
  }
  for (const e of side.effects.slice()) e.handler.onFriendlyDeath?.(b, e, dead);
  const opp = side.opponent;
  for (const m of listeners(opp)) {
    if (m.handler?.onEnemyDeath && isAlive(m)) m.handler.onEnemyDeath(b, m, dead);
  }
  for (const e of opp.effects.slice()) e.handler.onEnemyDeath?.(b, e, dead);
}

/** A friendly minion took damage: side-level listeners (Tiger Carving). */
export function emitFriendlyDamaged(b: Battle, damaged: Minion, amount: number): void {
  for (const e of damaged.side.effects.slice()) e.handler.onFriendlyDamaged?.(b, e, damaged, amount);
}

export function emitSummon(b: Battle, summoned: Minion): void {
  const side = summoned.side;
  const ls = listeners(side);
  const effects = side.effects.slice();
  for (const m of ls) {
    if (m !== summoned && m.handler?.onFriendlySummon && isAlive(m)) m.handler.onFriendlySummon(b, m, summoned);
  }
  for (const e of effects) e.handler.onFriendlySummon?.(b, e, summoned);
  for (const m of ls) {
    if (m !== summoned && m.handler?.afterFriendlySummon && isAlive(m)) m.handler.afterFriendlySummon(b, m, summoned);
  }
  for (const e of effects) e.handler.afterFriendlySummon?.(b, e, summoned);
}

export function emitReborn(b: Battle, reborn: Minion): void {
  const side = reborn.side;
  for (const m of listeners(side)) {
    if (m.handler?.onFriendlyReborn && isAlive(m)) m.handler.onFriendlyReborn(b, m, reborn);
  }
  for (const e of side.effects.slice()) e.handler.onFriendlyReborn?.(b, e, reborn);
}

export function emitDeathrattleTriggered(b: Battle, source: Minion): void {
  const side = source.side;
  side.deathrattlesTriggered++;
  for (const m of listeners(side)) {
    if (m.handler?.onDeathrattleTriggered && isAlive(m)) m.handler.onDeathrattleTriggered(b, m, source);
  }
  for (const e of side.effects.slice()) e.handler.onDeathrattleTriggered?.(b, e, source);
}

export function emitDivineShieldLost(b: Battle, lost: Minion): void {
  for (const m of listeners(lost.side)) {
    if (m.handler?.onFriendlyDivineShieldLost && (m === lost || isAlive(m))) {
      m.handler.onFriendlyDivineShieldLost(b, m, lost);
    }
  }
  for (const e of lost.side.effects.slice()) e.handler.onFriendlyDivineShieldLost?.(b, e, lost);
}

export function emitDamageDealt(b: Battle, dealer: Minion, target: Minion, amount: number): void {
  for (const m of listeners(dealer.side)) {
    if (m !== dealer && m.handler?.onFriendlyDealtDamage && isAlive(m)) {
      m.handler.onFriendlyDealtDamage(b, m, dealer, target, amount);
    }
  }
}

export function emitSpellCast(b: Battle, side: SideState, spellId: string, target: Minion | null): void {
  side.spellsCastThisCombat++;
  for (const m of listeners(side)) {
    if (m.handler?.onSpellCast && isAlive(m)) m.handler.onSpellCast(b, m, spellId, target);
  }
  for (const e of side.effects.slice()) e.handler.onSpellCast?.(b, e, spellId, target);
}

export function emitBoardEmpty(b: Battle, side: SideState): void {
  for (const e of side.effects.slice()) e.handler.onBoardEmpty?.(b, e);
}

/** Run `fn` with a nesting guard; returns false (and skips) beyond LIMITS.maxDepth. */
export function guarded(b: Battle, fn: () => void): boolean {
  if (b.depth >= LIMITS.maxDepth) return false;
  b.depth++;
  try {
    fn();
  } finally {
    b.depth--;
  }
  return true;
}
