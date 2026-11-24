/**
 * Card effect registry.
 *
 * Handlers are keyed by the NORMAL card id; golden versions resolve to the same
 * handler (via CardDb `normalId`, falling back to stripping a `_G` suffix) and
 * read `self.golden` / `self.mult` to scale their effect.
 *
 * - Minion handlers: `registerMinion(id, handler)`
 * - Side-level effects (hero powers, trinkets, quest rewards, anomalies):
 *   `registerEffect(id, handler)`
 * - Enchantments found on minion snapshots (e.g. granted deathrattles):
 *   `registerEnchantment(id, handler)`
 */
import type { CardDb } from '../../cards/cardDb';
import type { CardHandler, EffectHandler, EnchantmentHandler } from '../engine/types';

const minionHandlers = new Map<string, CardHandler>();
const effectHandlers = new Map<string, EffectHandler>();
const enchantmentHandlers = new Map<string, EnchantmentHandler>();
/** cardId -> resolved handler (or null), filled lazily per id. */
const resolvedMinion = new Map<string, CardHandler | null>();
const resolvedEffect = new Map<string, EffectHandler | null>();

function asList(ids: string | readonly string[]): readonly string[] {
  return typeof ids === 'string' ? [ids] : ids;
}

export function registerMinion(ids: string | readonly string[], handler: CardHandler): void {
  for (const id of asList(ids)) minionHandlers.set(id, handler);
  resolvedMinion.clear();
}

export function registerEffect(ids: string | readonly string[], handler: EffectHandler): void {
  for (const id of asList(ids)) effectHandlers.set(id, handler);
  resolvedEffect.clear();
}

export function registerEnchantment(ids: string | readonly string[], handler: EnchantmentHandler): void {
  for (const id of asList(ids)) enchantmentHandlers.set(id, handler);
}

function normalCandidates(cardId: string, db?: CardDb): string[] {
  const out: string[] = [];
  const normal = db?.get(cardId)?.normalId;
  if (normal) out.push(normal);
  if (/_G$/.test(cardId)) out.push(cardId.slice(0, -2));
  // Golden tokens such as BG19_010_Gt -> BG19_010t
  if (/_Gt\d*$/.test(cardId)) out.push(cardId.replace(/_G(t\d*)$/, '$1'));
  return out;
}

/** The handler registered under exactly this id (no golden/normal resolution). */
export function registeredMinionHandler(cardId: string): CardHandler | undefined {
  return minionHandlers.get(cardId);
}

export function getMinionHandler(cardId: string, db?: CardDb): CardHandler | undefined {
  const cached = resolvedMinion.get(cardId);
  if (cached !== undefined) return cached ?? undefined;
  let h = minionHandlers.get(cardId);
  if (!h) {
    for (const n of normalCandidates(cardId, db)) {
      h = minionHandlers.get(n);
      if (h) break;
    }
  }
  resolvedMinion.set(cardId, h ?? null);
  return h;
}

export function getEffectHandler(cardId: string, db?: CardDb): EffectHandler | undefined {
  const cached = resolvedEffect.get(cardId);
  if (cached !== undefined) return cached ?? undefined;
  let h = effectHandlers.get(cardId);
  if (!h) {
    for (const n of normalCandidates(cardId, db)) {
      h = effectHandlers.get(n);
      if (h) break;
    }
  }
  resolvedEffect.set(cardId, h ?? null);
  return h;
}

export function getEnchantmentHandler(cardId: string): EnchantmentHandler | undefined {
  return enchantmentHandlers.get(cardId);
}

export function registeredMinionIds(): string[] {
  return [...minionHandlers.keys()];
}

export function registeredEffectIds(): string[] {
  return [...effectHandlers.keys()];
}

export function registeredEnchantmentIds(): string[] {
  return [...enchantmentHandlers.keys()];
}
