/**
 * Building blocks shared by card handlers. Handlers should use these (and the
 * engine actions they re-export) rather than poking at the board directly.
 */
import type { BgCard, Tribe } from '@shared/types';
import type { CardDb } from '../../cards/cardDb';
import { aliveMinions, endAnchor, indexOf, isAlive, rightOfAnchor } from '../engine/board';
import { buff, summon } from '../engine/actions';
import { emitHandStatsGained } from '../engine/events';
import { hasTribe, minionFromCard, minionFromSnapshot, type TokenOptions } from '../engine/minion';
import type { Battle, DeathContext, HandMinion, Minion, SideState, SummonAnchor } from '../engine/types';

export * from '../engine/actions';
export { attackImmediately } from '../engine/attack';
export { triggerDeathrattlesArtificially, hasDeathrattle } from '../engine/deaths';
export { aliveMinions, endAnchor, indexOf, isAlive, neighbours, rightOfAnchor } from '../engine/board';
export { copyMinion, hasNoTribe, hasTribe, minionFromCard, minionFromSnapshot } from '../engine/minion';

/**
 * Read a script-data value (TAG_SCRIPT_DATA_NUM_n) of a minion: snapshot tags
 * first (they reflect in-game improvements), then the card definition (golden
 * cards carry doubled values), then `fallback`.
 */
export function sd(b: Battle, m: Minion, n: 1 | 2 | 3 | 4, fallback: number): number {
  const key = `TAG_SCRIPT_DATA_NUM_${n}`;
  const v = m.tags[key];
  if (typeof v === 'number') return v;
  const c = b.db.get(m.cardId)?.tags?.[key];
  return typeof c === 'number' ? c : fallback;
}

/** Summon `count` copies of a token through `anchor`. Returns the summoned minions. */
export function summonTokens(
  b: Battle,
  side: SideState,
  cardId: string,
  count: number,
  anchor: SummonAnchor,
  opts?: TokenOptions,
): Minion[] {
  const out: Minion[] = [];
  for (let i = 0; i < count; i++) {
    const m = minionFromCard(b, side, cardId, opts);
    if (!summon(b, side, m, anchor)) break;
    out.push(m);
  }
  return out;
}

/** Deathrattle summon helper: tokens appear in the dead minion's slot. */
export function summonForDeath(
  b: Battle,
  self: Minion,
  ctx: DeathContext,
  cardId: string,
  count: number,
  opts?: TokenOptions,
): Minion[] {
  return summonTokens(b, self.side, cardId, count, ctx.anchor, opts);
}

/** Summon to the right of a living minion. */
export function summonRightOf(b: Battle, self: Minion, cardId: string, count: number, opts?: TokenOptions): Minion[] {
  const anchor = indexOf(self) >= 0 ? rightOfAnchor(self) : endAnchor(self.side);
  return summonTokens(b, self.side, cardId, count, anchor, opts);
}

/** Give every living friendly minion matching `filter` +attack/+health. */
export function buffAll(
  b: Battle,
  side: SideState,
  attack: number,
  health: number,
  filter?: (m: Minion) => boolean,
  exclude?: Minion | null,
): void {
  for (const m of aliveMinions(side)) {
    if (m === exclude) continue;
    if (filter && !filter(m)) continue;
    buff(b, m, attack, health);
  }
}

export function tribeFilter(tribe: Tribe): (m: Minion) => boolean {
  return (m) => hasTribe(m, tribe);
}

// ---------------------------------------------------------------------------
// Beetles (Beast package): "Your Beetles have +X/+X this game"
// ---------------------------------------------------------------------------

export const BEETLE = 'BG28_603t';

export function isBeetle(m: Minion): boolean {
  return m.cardId === BEETLE || m.cardId === 'BG28_603t_G';
}

export function summonBeetles(b: Battle, side: SideState, count: number, anchor: SummonAnchor): Minion[] {
  return summonTokens(b, side, BEETLE, count, anchor, { attack: side.beetleAttack, health: side.beetleHealth });
}

export function improveBeetles(b: Battle, side: SideState, attack: number, health: number): void {
  side.beetleAttack += attack;
  side.beetleHealth += health;
  for (const m of aliveMinions(side)) if (isBeetle(m)) buff(b, m, attack, health);
}

// ---------------------------------------------------------------------------
// Undead: "Your Undead have +X Attack this game"
// ---------------------------------------------------------------------------

export function improveUndeadAttack(b: Battle, side: SideState, attack: number): void {
  side.undeadAttackBonus += attack;
  for (const m of aliveMinions(side)) if (hasTribe(m, 'UNDEAD')) buff(b, m, attack, 0);
}

// ---------------------------------------------------------------------------
// Random minions from the pool (Ghastcoiler, Deathly Striker, Embrace Your Rage...)
// ---------------------------------------------------------------------------

const poolCache = new WeakMap<CardDb, BgCard[]>();

function poolMinions(db: CardDb): BgCard[] {
  let p = poolCache.get(db);
  if (!p) {
    p = db.poolMinions();
    poolCache.set(db, p);
  }
  return p;
}

const filteredCache = new WeakMap<CardDb, Map<string, BgCard[]>>();

/**
 * Random pool minion matching `filter`, limited to the lobby's tribes (neutral
 * and all-type minions always qualify). `key` caches the filtered list.
 */
export function randomPoolMinion(b: Battle, key: string, filter: (c: BgCard) => boolean): BgCard | undefined {
  let byKey = filteredCache.get(b.db);
  if (!byKey) {
    byKey = new Map();
    filteredCache.set(b.db, byKey);
  }
  const tribes = b.input.availableTribes ?? [];
  const mode = b.input.mode ?? 'solo';
  const fullKey = `${key}|${mode}|${tribes.slice().sort().join(',')}`;
  let list = byKey.get(fullKey);
  if (!list) {
    list = poolMinions(b.db).filter((c) => {
      if (mode === 'solo' && (c.duosOnly || c.mechanics.includes('IS_BACON_DUOS_EXCLUSIVE'))) return false;
      if (mode === 'duos' && c.soloOnly) return false;
      if (tribes.length && c.tribes.length && !c.tribes.includes('ALL') && !c.tribes.some((t) => tribes.includes(t))) {
        return false;
      }
      return filter(c);
    });
    byKey.set(fullKey, list);
  }
  return b.rng.pick(list);
}

// ---------------------------------------------------------------------------
// Hand helpers
// ---------------------------------------------------------------------------

export function handMinions(b: Battle, side: SideState): HandMinion[] {
  return side.hand.filter((h) => {
    const c = b.db.get(h.cardId);
    return c ? c.type === 'MINION' : h.health > 0;
  });
}

export function highestInHand(
  b: Battle,
  side: SideState,
  by: 'attack' | 'health',
  filter?: (h: HandMinion) => boolean,
): HandMinion | undefined {
  let best: HandMinion | undefined;
  for (const h of handMinions(b, side)) {
    if (filter && !filter(h)) continue;
    if (!best || h[by] > best[by]) best = h;
  }
  return best;
}

/**
 * Buff a card in hand during combat. The snapshot is replaced too (never mutated: it belongs to
 * the input), so hand minions summoned later this combat (Diremuck Forager, Bassgill, Flighty
 * Scout) carry the bonus.
 */
export function buffHandCard(b: Battle, side: SideState, h: HandMinion, attack: number, health: number): void {
  h.attack += attack;
  h.health += health;
  h.snapshot = { ...h.snapshot, attack: h.attack, health: h.health, maxHealth: h.health };
  if (b.watchStatGain && (attack > 0 || health > 0)) emitHandStatsGained(b, side, h, Math.max(0, attack), Math.max(0, health));
}

/** Summon a hand card onto the board "for this combat only" (removes it from the combat hand). */
export function summonFromHand(b: Battle, side: SideState, card: HandMinion, anchor: SummonAnchor): Minion | null {
  const m = minionFromSnapshot(b, side, { ...card.snapshot, entityId: b.nextEntityId++ });
  if (!summon(b, side, m, anchor)) return null;
  const i = side.hand.indexOf(card);
  if (i >= 0) side.hand.splice(i, 1);
  return m;
}

/** Left-most / right-most living minion of a side matching a filter. */
export function leftMost(side: SideState, filter?: (m: Minion) => boolean): Minion | undefined {
  for (const m of side.board) if (isAlive(m) && (!filter || filter(m))) return m;
  return undefined;
}

export function rightMost(side: SideState, filter?: (m: Minion) => boolean): Minion | undefined {
  for (let i = side.board.length - 1; i >= 0; i--) {
    const m = side.board[i];
    if (isAlive(m) && (!filter || filter(m))) return m;
  }
  return undefined;
}

/** Highest value of `key` among living minions; ties broken randomly. */
export function highestBy(b: Battle, minions: Minion[], key: (m: Minion) => number): Minion | undefined {
  let best: Minion[] = [];
  let bestV = -Infinity;
  for (const m of minions) {
    const v = key(m);
    if (v > bestV) {
      bestV = v;
      best = [m];
    } else if (v === bestV) best.push(m);
  }
  return b.rng.pick(best);
}

export function lowestBy(b: Battle, minions: Minion[], key: (m: Minion) => number): Minion | undefined {
  return highestBy(b, minions, (m) => -key(m));
}

/** Per-minion counter helper ("3 times per combat"). */
export function counter(m: Minion, key: string, init: number): number {
  const c = (m.counters ??= {});
  if (!(key in c)) c[key] = init;
  return c[key];
}

export function setCounter(m: Minion, key: string, value: number): void {
  (m.counters ??= {})[key] = value;
}

export function isRallyMinion(b: Battle, m: Minion): boolean {
  return !!m.handler?.rally || !!b.db.get(m.cardId)?.mechanics.includes('BACON_RALLY');
}
