/**
 * Death resolution.
 *
 * One "death phase" pass:
 *   1. remove every dead minion (attacking side first, left to right), remembering its slot;
 *   2. per death: bookkeeping, Avenge counters, "whenever a friendly minion dies" triggers;
 *   3. fire Avenge effects that completed;
 *   4. Deathrattles in the same order (summons take the dead minion's slot), repeated for
 *      Titus Rivendare & co.;
 *   5. Reborn (after all deathrattles of the batch), right of the deathrattle summons;
 *   6. "When you have space" summons.
 * Passes repeat while new deaths happen (deathrattle damage, Leeroy, ...).
 */
import { recalcAuras } from './auras';
import { endAnchor, isAlive, removeAt, rightOfAnchor } from './board';
import { LIMITS } from './constants';
import { emitBoardEmpty, emitDeathrattleTriggered, emitFriendlyDeath, emitReborn, guarded } from './events';
import { hasTribe, minionFromCard, rebornCopy } from './minion';
import { processSpaceSummons, queueSpaceSummon, summon } from './actions';
import type { Battle, DeadRecord, DeathContext, EffectInstance, Minion, SideState, SummonAnchor } from './types';

export function hasDeathrattle(m: Minion): boolean {
  return !!m.handler?.deathrattle || m.extraDeathrattles.length > 0;
}

/** How many times this side's deathrattles trigger (1 + Titus + rewards/anomalies). */
export function deathrattleMultiplier(side: SideState): number {
  let n = 1 + side.extraDeathrattleTriggers;
  const board = side.board;
  for (let i = 0; i < board.length; i++) {
    const m = board[i];
    if ((m.cardId === 'BG25_354' || m.cardId === 'BG25_354_G') && isAlive(m)) n += m.golden ? 2 : 1;
    else if (isDeios(m) && isAlive(m)) n += m.golden ? 2 : 1;
  }
  return n;
}

/** Timewarped Deios: "Your Battlecries, Deathrattles, and Rallies trigger twice" (golden: three times). */
export function isDeios(m: Minion): boolean {
  return m.cardId === 'BG34_Giant_376' || m.cardId === 'BG34_Giant_376_G';
}

/** How many times this side's Rallies trigger (1 + Timewarped Deios). */
export function rallyMultiplier(side: SideState): number {
  let n = 1;
  const board = side.board;
  for (let i = 0; i < board.length; i++) {
    const m = board[i];
    if (isDeios(m) && isAlive(m)) n += m.golden ? 2 : 1;
  }
  return n;
}

/**
 * Trigger all deathrattles of `m` (its own + granted), `times` times.
 * Used for real deaths and for "trigger a Deathrattle" effects (artificial).
 */
export function triggerDeathrattles(
  b: Battle,
  m: Minion,
  anchor: SummonAnchor,
  artificial: boolean,
  times?: number,
): void {
  if (!hasDeathrattle(m)) return;
  const side = m.side;
  let n = times ?? deathrattleMultiplier(side);
  if (side.nextDeathrattleBonus > 0) {
    n += side.nextDeathrattleBonus;
    side.nextDeathrattleBonus = 0;
  }
  const killer = m.killedBy;
  for (let r = 0; r < n; r++) {
    const own = m.handler?.deathrattle;
    if (own) {
      const ctx: DeathContext = { anchor, killer, golden: m.golden, mult: m.mult, artificial };
      guarded(b, () => own(b, m, ctx));
      emitDeathrattleTriggered(b, m);
    }
    const extras = m.extraDeathrattles.slice();
    for (const g of extras) {
      const ctx: DeathContext = { anchor, killer, golden: g.golden, mult: g.golden ? 2 : 1, artificial };
      guarded(b, () => g.fn(b, m, ctx));
      emitDeathrattleTriggered(b, m);
    }
  }
}

/** Trigger a living minion's deathrattles (Deathstrider, Herald Sticker...). */
export function triggerDeathrattlesArtificially(b: Battle, m: Minion, times = 1): void {
  triggerDeathrattles(b, m, rightOfAnchor(m), true, times * deathrattleMultiplier(m.side));
}

function avengeThreshold(avenge: number | ((x: never) => number), subject: unknown): number {
  return typeof avenge === 'number' ? avenge : (avenge as (x: unknown) => number)(subject);
}

type AvengeEntry = { m: Minion; e?: undefined } | { m?: undefined; e: EffectInstance };

function onDeath(b: Battle, dead: Minion, avenges: AvengeEntry[]): void {
  const side = dead.side;
  side.deadThisCombat.push(dead);
  side.friendlyDeaths++;
  dead.handler?.onSelfDeath?.(b, dead);
  // Avenge counters of living friendly minions and side effects.
  const board = side.board;
  for (let i = 0; i < board.length; i++) {
    const m = board[i];
    const h = m.handler;
    if (!h?.avenge || !isAlive(m)) continue;
    m.avengeProgress++;
    if (m.avengeProgress >= avengeThreshold(h.avenge, m)) {
      m.avengeProgress = 0;
      avenges.push({ m });
    }
  }
  for (const e of side.effects) {
    const h = e.handler;
    if (!h.avenge) continue;
    e.progress++;
    if (e.progress >= avengeThreshold(h.avenge, e)) {
      e.progress = 0;
      avenges.push({ e });
    }
  }
  // Deity: awakens after N friendly Aberrations died this combat.
  const d = side.deity;
  if (d && !d.awakened && !dead.isDeity && hasTribe(dead, 'ABERRATION')) {
    d.progress++;
    if (d.progress >= d.threshold) awakenDeity(b, side);
  }
  emitFriendlyDeath(b, dead);
}

function awakenDeity(b: Battle, side: SideState): void {
  const d = side.deity!;
  d.awakened = true;
  queueSpaceSummon(side, {
    remaining: 1,
    make: (bb, s) => {
      const m = minionFromCard(bb, s, d.cardId, {
        golden: d.golden,
        attack: Math.max(0, d.attack),
        health: Math.max(1, d.health),
        tribes: ['ABERRATION'],
      });
      m.isDeity = true;
      d.minion = m;
      return m;
    },
    after: (bb, m) => {
      for (const e of side.effects) e.handler.onDeityAwakened?.(bb, e, m);
    },
  });
}

function fireAvenges(b: Battle, avenges: AvengeEntry[]): void {
  for (const a of avenges) {
    if (a.m) {
      const m = a.m;
      if (!isAlive(m)) continue;
      guarded(b, () => m.handler!.onAvenge?.(b, m));
    } else if (a.e) {
      const e = a.e;
      guarded(b, () => e.handler.onAvenge?.(b, e));
    }
  }
}

function doReborn(b: Battle, rec: DeadRecord): void {
  const dead = rec.minion;
  const m = rebornCopy(b, dead);
  if (summon(b, rec.side, m, rec)) emitReborn(b, m);
}

/** Resolve all pending deaths (no-op when called re-entrantly). */
export function resolveDeaths(b: Battle): void {
  if (b.resolvingDeaths) return;
  b.resolvingDeaths = true;
  try {
    for (let pass = 0; pass < LIMITS.maxDeathPasses; pass++) {
      const first = b.sides[b.activeSide];
      const order: SideState[] = [first, first.opponent];
      const records: DeadRecord[] = [];
      for (const side of order) {
        const board = side.board;
        let originalIndex = 0;
        for (let i = 0; i < board.length; originalIndex++) {
          const m = board[i];
          if (m.health <= 0 || m.destroyed) {
            const rec: DeadRecord = {
              side,
              slot: i,
              order: b.recordSeq++,
              rightOf: null,
              inserted: 0,
              minion: m,
              originalIndex,
            };
            removeAt(side, i, rec);
            side.pendingRecords.push(rec);
            m.removed = true;
            records.push(rec);
          } else {
            i++;
          }
        }
      }
      if (records.length === 0) break;

      if (b.log) for (const rec of records) b.log.push(`dies ${rec.side.index === 0 ? 'P' : 'O'}:${rec.minion.name}#${rec.minion.entityId}`);
      const avenges: AvengeEntry[] = [];
      for (const rec of records) onDeath(b, rec.minion, avenges);
      fireAvenges(b, avenges);
      for (const rec of records) triggerDeathrattles(b, rec.minion, rec, false);
      for (const rec of records) if (rec.minion.reborn) doReborn(b, rec);

      for (const side of order) {
        side.pendingRecords.length = 0;
        side.ptrTie = -1;
      }
      for (const side of order) {
        if (side.board.length === 0) emitBoardEmpty(b, side);
      }
      processSpaceSummons(b);
      if (b.hasAuras) recalcAuras(b);
    }
  } finally {
    b.resolvingDeaths = false;
    for (const side of b.sides) {
      side.pendingRecords.length = 0;
      side.ptrTie = -1;
    }
  }
}

/** Anchor at the end of a board (re-exported for handlers). */
export { endAnchor };
