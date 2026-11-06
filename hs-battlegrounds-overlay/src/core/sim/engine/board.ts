/**
 * Board bookkeeping: inserting/removing minions while keeping the "next
 * attacker" pointer and the slots of dead minions (summon positions) consistent.
 *
 * Attack order model: each side has a pointer to the board index of its next
 * attacker. After a minion attacks, the pointer moves right of it. Removing a
 * minion left of the pointer shifts it left, inserting left of it shifts it
 * right. Minions summoned into the slot of the minion the pointer refers to
 * (e.g. Deathrattle tokens of an attacker that died) attack next.
 */
import type { DeadRecord, Minion, SideState, SummonAnchor } from './types';

export function isAlive(m: Minion): boolean {
  return !m.removed && !m.destroyed && m.health > 0;
}

export function aliveMinions(side: SideState): Minion[] {
  const out: Minion[] = [];
  const board = side.board;
  for (let i = 0; i < board.length; i++) if (isAlive(board[i])) out.push(board[i]);
  return out;
}

export function aliveCount(side: SideState): number {
  let n = 0;
  const board = side.board;
  for (let i = 0; i < board.length; i++) if (isAlive(board[i])) n++;
  return n;
}

export function indexOf(m: Minion): number {
  return m.removed ? -1 : m.side.board.indexOf(m);
}

/** Living neighbours (left, right) of a minion on its board. */
export function neighbours(m: Minion): Minion[] {
  const board = m.side.board;
  const i = board.indexOf(m);
  const out: Minion[] = [];
  if (i < 0) return out;
  for (let j = i - 1; j >= 0; j--) {
    if (isAlive(board[j])) {
      out.push(board[j]);
      break;
    }
  }
  for (let j = i + 1; j < board.length; j++) {
    if (isAlive(board[j])) {
      out.push(board[j]);
      break;
    }
  }
  return out;
}

/** Anchor that inserts at the right end of the board. */
export function endAnchor(side: SideState): SummonAnchor {
  return { side, slot: side.board.length, order: -1, rightOf: null, inserted: 0 };
}

/** Anchor that inserts right of a (living) minion, consecutive summons left-to-right. */
export function rightOfAnchor(m: Minion): SummonAnchor {
  const i = m.side.board.indexOf(m);
  return { side: m.side, slot: i < 0 ? m.side.board.length : i + 1, order: -1, rightOf: m, inserted: 0 };
}

/** Anchor that inserts at a given index. */
export function indexAnchor(side: SideState, index: number): SummonAnchor {
  return { side, slot: Math.max(0, Math.min(index, side.board.length)), order: -1, rightOf: null, inserted: 0 };
}

export function anchorIndex(a: SummonAnchor): number {
  const len = a.side.board.length;
  if (a.rightOf) {
    const i = a.side.board.indexOf(a.rightOf);
    if (i >= 0) return Math.min(len, i + 1 + a.inserted);
  }
  return Math.max(0, Math.min(a.slot, len));
}

/** Insert `m` into `side.board` at `idx`. `anchor` is the anchor the insert came from. */
export function insertAt(side: SideState, idx: number, m: Minion, anchor: SummonAnchor | null): void {
  side.board.splice(idx, 0, m);
  const isRecord = !!anchor && anchor.order >= 0;
  const ptr = side.attackPtr;
  if (
    idx < ptr ||
    (idx === ptr && side.ptrTie >= 0 && (isRecord ? anchor!.order < side.ptrTie : true))
  ) {
    side.attackPtr = ptr + 1;
  }
  const recs = side.pendingRecords;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r === anchor) continue;
    if (r.slot > idx || (r.slot === idx && (isRecord ? r.order > anchor!.order : true))) r.slot++;
  }
  if (anchor) {
    anchor.inserted++;
    if (!anchor.rightOf || anchor.side.board.indexOf(anchor.rightOf) < 0) anchor.slot = idx + 1;
  }
}

/** Remove the minion at `idx` (a death when `rec` is given). */
export function removeAt(side: SideState, idx: number, rec: DeadRecord | null): Minion {
  const m = side.board[idx];
  side.board.splice(idx, 1);
  const ptr = side.attackPtr;
  if (idx < ptr) {
    side.attackPtr = ptr - 1;
    if (rec && idx === ptr - 1) {
      // The minion right before the pointer: either the attacker that just died
      // (its summons attack next) or a minion left of the next attacker.
      if (m === side.lastAttacker) side.ptrTie = rec.order;
      else if (side.ptrTie < 0) side.ptrTie = rec.order + 0.5;
    }
  } else if (idx === ptr && rec && side.ptrTie < 0) {
    // The next attacker died: its summons take its turn.
    side.ptrTie = rec.order;
  }
  const recs = side.pendingRecords;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r !== rec && r.slot > idx) r.slot--;
  }
  return m;
}
