/**
 * Monte Carlo battle simulator entry point.
 *
 * `simulateBattle` runs the combat many times with a seeded RNG and aggregates
 * win / tie / loss chances, damage and lethal probabilities. Pure and
 * synchronous; never throws (a failing iteration counts as a tie).
 */
import type { BattleSimInput, BattleSimOptions, BattleSimResult, BgCard, MinionSnapshot, SimSide } from '@shared/types';
import { CardDb } from '../cards/cardDb';
import { ensureCardsRegistered, getEffectHandler, getMinionHandler } from './cards';
import { createBattle, runBattle, type BattleOutcome } from './engine/battle';
import { randomSeed, Rng } from './engine/rng';

export const DEFAULT_ITERATIONS = 4000;
export const DEFAULT_MAX_DURATION_MS = 1500;

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

const COMBAT_MECHANICS = ['DEATHRATTLE', 'START_OF_COMBAT', 'AVENGE', 'BACON_RALLY', 'OVERKILL'];
const COMBAT_TEXT =
  /start of combat|in combat|this combat|attacks?\b|dies|died|takes damage|deals? damage|is reborn|summon|divine shield|deathrattle|avenge|rally/i;

function stripText(t: string | undefined): string {
  return (t ?? '').replace(/<[^>]+>/g, ' ');
}

/** Whether a minion card has effects beyond keywords that matter in combat. */
function minionNeedsHandler(card: BgCard | undefined, snap: MinionSnapshot): boolean {
  if (!card) {
    const k = snap.keywords ?? {};
    return !!(k.deathrattle || k.startOfCombat || k.avenge);
  }
  if (card.mechanics.some((m) => COMBAT_MECHANICS.includes(m))) return true;
  const triggered = card.mechanics.includes('TRIGGER_VISUAL') || card.mechanics.includes('AURA');
  return triggered && COMBAT_TEXT.test(stripText(card.text));
}

function effectNeedsHandler(card: BgCard | undefined): boolean {
  if (!card) return false;
  if (card.mechanics.includes('START_OF_COMBAT') || card.mechanics.includes('AVENGE')) return true;
  return /start of combat|in combat|this combat|avenge|attacks|dies|reborn/i.test(stripText(card.text));
}

function collectSide(side: SimSide | undefined, db: CardDb, out: Set<string>): void {
  if (!side) return;
  const minions = [...(side.minions ?? []), ...(side.teammate?.minions ?? [])];
  for (const m of minions) {
    const h = getMinionHandler(m.cardId, db);
    if (h) continue;
    if (minionNeedsHandler(db.get(m.cardId), m)) out.add(m.cardId);
  }
  const effects: string[] = [];
  if (side.heroPowerCardId) effects.push(side.heroPowerCardId);
  for (const t of side.trinkets ?? []) effects.push(t.cardId);
  for (const q of side.questRewards ?? []) effects.push(q);
  for (const id of effects) {
    if (!getEffectHandler(id, db) && effectNeedsHandler(db.get(id))) out.add(id);
  }
}

/** Card ids in the input whose combat effects the simulator does not implement. */
export function findUnsupportedCards(input: BattleSimInput, db: CardDb = CardDb.bundled()): string[] {
  ensureCardsRegistered();
  const out = new Set<string>();
  collectSide(input.player, db, out);
  collectSide(input.opponent, db, out);
  if (input.anomalyCardId && !getEffectHandler(input.anomalyCardId, db) && effectNeedsHandler(db.get(input.anomalyCardId))) {
    out.add(input.anomalyCardId);
  }
  return [...out].sort();
}

function totalHealth(side: SimSide | undefined): number {
  if (!side) return 0;
  return (side.health ?? 0) + (side.armor ?? 0);
}

/** Run a single combat (exposed for tests and debugging). */
export function simulateOnce(input: BattleSimInput, rng: Rng, db: CardDb = CardDb.bundled()): BattleOutcome {
  ensureCardsRegistered();
  return runBattle(createBattle(input, db, rng));
}

export function simulateBattle(
  input: BattleSimInput,
  options: BattleSimOptions = {},
  cardDb?: CardDb,
): BattleSimResult {
  const start = now();
  const db = cardDb ?? CardDb.bundled();
  ensureCardsRegistered();

  const iterations = Math.max(1, Math.floor(options.iterations ?? DEFAULT_ITERATIONS));
  const maxMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const rng = new Rng(options.seed ?? randomSeed());

  let unsupported: string[] = [];
  try {
    unsupported = findUnsupportedCards(input, db);
  } catch {
    unsupported = [];
  }

  const oppHp = totalHealth(input.opponent);
  const ourHp = totalHealth(input.player);
  let n = 0;
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let dealtSum = 0;
  let takenSum = 0;
  let lethalWins = 0;
  let lethalLosses = 0;
  const dist = new Map<number, number>();

  while (n < iterations) {
    if (n > 0 && (n & 15) === 0 && now() - start > maxMs) break;
    let out: BattleOutcome;
    try {
      out = runBattle(createBattle(input, db, rng));
    } catch {
      out = { result: 0, damage: 0 };
    }
    n++;
    if (out.result === 1) {
      wins++;
      dealtSum += out.damage;
      if (oppHp > 0 && out.damage >= oppHp) lethalWins++;
      dist.set(out.damage, (dist.get(out.damage) ?? 0) + 1);
    } else if (out.result === -1) {
      losses++;
      takenSum += out.damage;
      if (ourHp > 0 && out.damage >= ourHp) lethalLosses++;
      dist.set(-out.damage, (dist.get(-out.damage) ?? 0) + 1);
    } else {
      ties++;
      dist.set(0, (dist.get(0) ?? 0) + 1);
    }
  }

  const pct = (x: number) => (n ? (x / n) * 100 : 0);
  const damageDistribution: Record<string, number> = {};
  for (const [k, v] of [...dist.entries()].sort((a, b) => a[0] - b[0])) damageDistribution[String(k)] = v / n;

  return {
    win: pct(wins),
    tie: pct(ties),
    loss: pct(losses),
    avgDamageDealt: wins ? dealtSum / wins : 0,
    avgDamageTaken: losses ? takenSum / losses : 0,
    lethalWin: pct(lethalWins),
    lethalLoss: pct(lethalLosses),
    iterations: n,
    durationMs: Math.round((now() - start) * 10) / 10,
    unsupported,
    damageDistribution,
  };
}
