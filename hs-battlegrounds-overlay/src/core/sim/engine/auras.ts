/**
 * Static aura recalculation ("Your other Murlocs have +2 Attack", "Adjacent
 * minions have ..."). Aura bonuses are stored on each minion (`auraAttack`,
 * `auraHealth`) and applied as deltas so the rest of the engine only ever reads
 * `attack` / `health`.
 *
 * Snapshot stats already include the auras active when the board was captured,
 * so `initAuras` records the current bonuses without changing stats.
 */
import { isAlive } from './board';
import type { Battle, Minion } from './types';

/** Aura bonus `target` currently receives from its board. */
export function auraBonus(b: Battle, target: Minion): { attack: number; health: number } {
  return computeBonus(b, target);
}

function computeBonus(b: Battle, target: Minion): { attack: number; health: number } {
  let attack = 0;
  let health = 0;
  const board = target.side.board;
  for (let i = 0; i < board.length; i++) {
    const src = board[i];
    if (!src.handler?.aura || !isAlive(src)) continue;
    const bonus = src.handler.aura(b, src, target);
    if (bonus) {
      attack += bonus.attack;
      health += bonus.health;
    }
  }
  return { attack, health };
}

/** Record the aura bonuses already baked into snapshot stats. */
export function initAuras(b: Battle): void {
  if (!b.hasAuras) return;
  for (const side of b.sides) {
    for (const m of side.board) {
      const bonus = computeBonus(b, m);
      m.auraAttack = bonus.attack;
      m.auraHealth = bonus.health;
    }
  }
}

/** Re-apply auras after the board changed. */
export function recalcAuras(b: Battle): void {
  if (!b.hasAuras) return;
  for (const side of b.sides) {
    for (const m of side.board) {
      if (m.removed) continue;
      const bonus = computeBonus(b, m);
      const da = bonus.attack - m.auraAttack;
      const dh = bonus.health - m.auraHealth;
      if (da !== 0) {
        m.attack = Math.max(0, m.attack + da);
        m.auraAttack = bonus.attack;
      }
      if (dh !== 0) {
        if (dh > 0) {
          m.maxHealth += dh;
          m.health += dh;
        } else {
          // Losing a Health aura never kills: Health is capped by the new maximum.
          m.maxHealth = Math.max(1, m.maxHealth + dh);
          if (m.health > m.maxHealth) m.health = m.maxHealth;
        }
        m.auraHealth = bonus.health;
      }
    }
  }
}
