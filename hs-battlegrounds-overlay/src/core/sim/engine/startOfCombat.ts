/**
 * Start of Combat phase.
 *
 * Order (each step: the side that attacks first goes first):
 *   1. hero powers   2. quest rewards   3. trinkets   4. anomaly
 *   5. Start of Combat effects of cards in hand (Flighty Scout)
 *   6. minion Start of Combat effects, alternating between the two sides
 *      (first attacker's left-most first), each repeated `socMultiplier` times
 *   7. "when you have space" summons
 * Deaths are resolved after every individual effect.
 */
import { getMinionHandler } from '../cards/registry';
import { isAlive } from './board';
import { processSpaceSummons } from './actions';
import { resolveDeaths } from './deaths';
import { guarded } from './events';
import type { Battle, EffectKind, Minion, SideState } from './types';

const EFFECT_ORDER: EffectKind[] = ['heroPower', 'questReward', 'trinket', 'anomaly'];

function runEffects(b: Battle, side: SideState, kind: EffectKind): void {
  for (const e of side.effects.slice()) {
    if (e.kind !== kind || !e.handler.startOfCombat) continue;
    b.activeSide = side.index;
    guarded(b, () => e.handler.startOfCombat!(b, e));
    resolveDeaths(b);
  }
}

function runHand(b: Battle, side: SideState): void {
  for (const card of side.hand.slice()) {
    const h = getMinionHandler(card.cardId, b.db);
    if (!h?.handStartOfCombat) continue;
    b.activeSide = side.index;
    guarded(b, () => h.handStartOfCombat!(b, card, side));
    resolveDeaths(b);
  }
}

function runMinion(b: Battle, m: Minion): void {
  if (!isAlive(m) || !m.handler?.startOfCombat) return;
  const side = m.side;
  let times = side.socMultiplier;
  if (side.nextStartOfCombatBonus > 0) {
    times += side.nextStartOfCombatBonus;
    side.nextStartOfCombatBonus = 0;
  }
  b.activeSide = side.index;
  for (let i = 0; i < times; i++) {
    if (!isAlive(m)) break;
    guarded(b, () => m.handler!.startOfCombat!(b, m));
  }
  resolveDeaths(b);
}

export function startOfCombat(b: Battle): void {
  const first = b.sides[b.firstSide];
  const second = first.opponent;
  for (const kind of EFFECT_ORDER) {
    runEffects(b, first, kind);
    runEffects(b, second, kind);
  }
  runHand(b, first);
  runHand(b, second);

  const l1 = first.board.filter((m) => m.handler?.startOfCombat);
  const l2 = second.board.filter((m) => m.handler?.startOfCombat);
  let i = 0;
  let j = 0;
  let turnFirst = true;
  while (i < l1.length || j < l2.length) {
    if ((turnFirst && i < l1.length) || j >= l2.length) runMinion(b, l1[i++]);
    else runMinion(b, l2[j++]);
    turnFirst = !turnFirst;
  }
  processSpaceSummons(b);
  resolveDeaths(b);
}

/**
 * Duos: Start of Combat of a board that joins mid-combat (hero power, quest rewards, trinkets,
 * hand, then its minions left to right). The anomaly does not trigger again.
 */
export function startOfCombatForSide(b: Battle, side: SideState): void {
  for (const kind of EFFECT_ORDER) if (kind !== 'anomaly') runEffects(b, side, kind);
  runHand(b, side);
  for (const m of side.board.filter((x) => x.handler?.startOfCombat)) runMinion(b, m);
  processSpaceSummons(b);
  resolveDeaths(b);
}
