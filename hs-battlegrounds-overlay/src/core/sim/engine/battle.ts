/**
 * One simulated combat: build the mutable battle state from a BattleSimInput,
 * run Start of Combat and the attack loop, and compute the outcome.
 */
import type { BattleSimInput, MinionSnapshot, SimSide } from '@shared/types';
import type { CardDb } from '../../cards/cardDb';
import { getEffectHandler } from '../cards/registry';
import { auraBonus, initAuras } from './auras';
import { aliveCount, aliveMinions } from './board';
import { LIMITS, TAG } from './constants';
import { sideCanAttack, takeTurn } from './attack';
import { resolveDeaths } from './deaths';
import { minionFromSnapshot } from './minion';
import type { Rng } from './rng';
import { startOfCombat, startOfCombatForSide } from './startOfCombat';
import type { Battle, DeityState, EffectInstance, EffectKind, HandMinion, Minion, SideState } from './types';

export interface BattleOutcome {
  /** 1 = player won, -1 = player lost, 0 = tie. */
  result: 1 | 0 | -1;
  /** Damage dealt to the loser (0 on tie). */
  damage: number;
}

function sortedMinions(list: MinionSnapshot[]): MinionSnapshot[] {
  return list.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
}

function tag(s: Omit<SimSide, 'teammate'>, name: string): number | undefined {
  return s.playerTags?.[name] ?? s.heroTags?.[name];
}

function maxScriptData(minions: MinionSnapshot[], cardIds: string[], key: string): number | undefined {
  let best: number | undefined;
  for (const m of minions) {
    if (!cardIds.some((id) => m.cardId.startsWith(id))) continue;
    const v = m.tags?.[key];
    if (typeof v === 'number' && (best === undefined || v > best)) best = v;
  }
  return best;
}

const BEETLE_CARDS = ['BG31_803', 'BG31_801', 'BG31_809', 'BG36_209', 'BG31_807', 'BG31_808', 'BG32_204', 'BG34_Giant_687'];

function makeDeity(b: Battle, s: Omit<SimSide, 'teammate'>): DeityState | null {
  const dbf = tag(s, TAG.OLD_GOD_DBID);
  let card = dbf ? b.db.getByDbfId(dbf) : undefined;
  if (!card) {
    // Fallback: a Deity card kept in hand.
    const inHand = s.hand?.find((h) => b.db.get(h.cardId)?.mechanics.includes('BACON_OLD_GOD'));
    if (inHand) card = b.db.get(inHand.cardId);
  }
  if (!card) return null;
  const golden = !!card.golden;
  return {
    cardId: card.normalId ?? card.id,
    golden,
    attack: tag(s, TAG.OLD_GOD_ATK) ?? card.attack ?? 1,
    health: tag(s, TAG.OLD_GOD_HP) ?? card.health ?? 1,
    // The lobby's real value comes from the player's Secret Deity entity (tracker), else card data.
    threshold: tag(s, TAG.DEITY_THRESHOLD) || (b.db.get('BG_OldGod')?.tags?.[TAG.SD1] ?? 4),
    progress: 0,
    awakened: false,
    minion: null,
  };
}

function addEffect(b: Battle, side: SideState, cardId: string, kind: EffectKind, sd1?: number, sd2?: number): EffectInstance | undefined {
  const handler = getEffectHandler(cardId, b.db);
  if (!handler) return undefined;
  const e: EffectInstance = { cardId, kind, handler, side, progress: 0, scriptData1: sd1, scriptData2: sd2, data: {} };
  side.effects.push(e);
  return e;
}

/** Player-level state derived from one player's input (also used when a Duos teammate takes over). */
function playerFields(b: Battle, s: Omit<SimSide, 'teammate'>, minions: MinionSnapshot[]) {
  return {
    tavernTier: s.tavernTier || 1,
    heroHealth: s.health ?? 0,
    heroArmor: s.armor ?? 0,
    heroCardId: s.heroCardId,
    heroPowerCardId: s.heroPowerCardId,
    heroPowerUsed: !!s.heroPowerUsed,
    heroPowerData: s.heroPowerData ?? {},
    playerTags: s.playerTags ?? {},
    heroTags: s.heroTags ?? {},
    hand: (s.hand ?? []).map(
      (h): HandMinion => ({
        cardId: h.cardId,
        attack: h.attack,
        health: h.health,
        golden: h.golden,
        tribes: h.tribes?.length ? h.tribes : b.db.tribes(h.cardId),
        snapshot: h,
      }),
    ),
    effects: [] as EffectInstance[],
    deadThisCombat: [] as Minion[],
    friendlyDeaths: 0,
    spaceQueue: [] as SideState['spaceQueue'],
    summonBuffs: [] as SideState['summonBuffs'],
    bloodGemAttack: 1 + (tag(s, TAG.BLOOD_GEM_ATK) ?? 0),
    bloodGemHealth: 1 + (tag(s, TAG.BLOOD_GEM_HP) ?? 0),
    spellAttackBonus: tag(s, TAG.SPELL_ATK) ?? tag(s, TAG.SPELL_ATK_REAL) ?? 0,
    spellHealthBonus: tag(s, TAG.SPELL_HP) ?? tag(s, TAG.SPELL_HP_REAL) ?? 0,
    beetleAttack: tag(s, TAG.BEETLE_ATK) ?? maxScriptData(minions, BEETLE_CARDS, TAG.SD1) ?? 2,
    beetleHealth: tag(s, TAG.BEETLE_HP) ?? maxScriptData(minions, BEETLE_CARDS, TAG.SD2) ?? 2,
    undeadAttackBonus: tag(s, TAG.UNDEAD_ATK) ?? 0,
    eternalKnightsDead: tag(s, TAG.ETERNAL_KNIGHTS_DEAD) ?? 0,
    deathrattlesTriggered: 0,
    spellsCastThisCombat: 0,
    deity: makeDeity(b, s),
    socMultiplier: 1,
    extraDeathrattleTriggers: 0,
    nextDeathrattleBonus: 0,
    nextStartOfCombatBonus: 0,
  };
}

/** Hero power, quest rewards and trinkets of one player become side-level effects. */
function addPlayerEffects(b: Battle, side: SideState, s: Omit<SimSide, 'teammate'>): void {
  if (s.heroPowerCardId) {
    const e = addEffect(b, side, s.heroPowerCardId, 'heroPower', s.heroPowerData?.scriptData1, s.heroPowerData?.scriptData2);
    if (e) {
      e.scriptData3 = s.heroPowerData?.scriptData3;
      e.used = !!s.heroPowerUsed;
    }
  }
  for (const hp of s.extraHeroPowers ?? []) {
    if (hp.cardId === s.heroPowerCardId) continue;
    const e = addEffect(b, side, hp.cardId, 'heroPower', hp.scriptData1, hp.scriptData2);
    if (e) {
      e.scriptData3 = hp.scriptData3;
      e.used = !!hp.used;
    }
  }
  for (const q of s.questRewards ?? []) addEffect(b, side, q, 'questReward');
  for (const t of s.trinkets ?? []) addEffect(b, side, t.cardId, 'trinket', t.scriptData1, t.scriptData2);
}

function createSide(b: Battle, index: 0 | 1, s: SimSide): SideState {
  const minions = sortedMinions(s.minions ?? []);
  const side: SideState = {
    index,
    board: [],
    opponent: undefined as unknown as SideState,
    attackPtr: 0,
    lastAttacker: null,
    ptrTie: -1,
    pendingRecords: [],
    ...playerFields(b, s, minions),
    teammate: s.teammate
      ? {
          minions: sortedMinions(s.teammate.minions ?? []),
          tavernTier: s.teammate.tavernTier || 1,
          heroCardId: s.teammate.heroCardId,
          heroHealth: s.teammate.health ?? 0,
          heroArmor: s.teammate.armor ?? 0,
          source: s.teammate,
        }
      : null,
  };
  for (const snap of minions) {
    const m = minionFromSnapshot(b, side, snap);
    side.board.push(m);
    if (m.handler?.aura) b.hasAuras = true;
  }
  addPlayerEffects(b, side, s);
  return side;
}

export function createBattle(input: BattleSimInput, db: CardDb, rng: Rng): Battle {
  const b: Battle = {
    rng,
    db,
    input,
    sides: undefined as unknown as [SideState, SideState],
    firstSide: 0,
    activeSide: 0,
    nextEntityId: 1_000_000,
    recordSeq: 0,
    resolvingDeaths: false,
    depth: 0,
    hasAuras: false,
    attacks: 0,
    log: null,
  };
  const p = createSide(b, 0, input.player);
  const o = createSide(b, 1, input.opponent);
  p.opponent = o;
  o.opponent = p;
  b.sides = [p, o];
  if (input.anomalyCardId) {
    addEffect(b, p, input.anomalyCardId, 'anomaly');
    addEffect(b, o, input.anomalyCardId, 'anomaly');
  }
  // Static effects of side-level cards that are not triggers (e.g. "trigger an extra time").
  for (const side of b.sides) for (const e of side.effects) e.handler.init?.(b, e);
  initAuras(b);
  return b;
}

/**
 * Duos: when a side's board is exhausted, its teammate takes over. The teammate brings their own
 * board, hero power, trinkets, quest rewards, hand, Deity and "this combat" counters (the game
 * swaps the hero, hero power, trinkets and Deity entities at that point), and their Start of
 * Combat effects trigger when they enter.
 */
function joinTeammate(b: Battle, side: SideState): boolean {
  const t = side.teammate;
  if (!t || side.board.length > 0) return false;
  side.teammate = null;
  side.attackPtr = 0;
  side.lastAttacker = null;
  if (t.source) {
    const anomalies = side.effects.filter((e) => e.kind === 'anomaly');
    Object.assign(side, playerFields(b, t.source, t.minions));
    addPlayerEffects(b, side, t.source);
    for (const e of side.effects) e.handler.init?.(b, e);
    side.effects.push(...anomalies);
    if (side.deity) {
      side.deity.attack += t.deityAttack ?? 0;
      side.deity.health += t.deityHealth ?? 0;
    }
  } else {
    side.tavernTier = t.tavernTier;
    side.heroCardId = t.heroCardId;
  }
  for (const snap of t.minions) {
    const m = minionFromSnapshot(b, side, snap);
    side.board.push(m);
    if (m.handler?.aura) b.hasAuras = true;
  }
  if (b.hasAuras) {
    for (const m of side.board) {
      const bonus = auraBonus(b, m);
      m.auraAttack = bonus.attack;
      m.auraHealth = bonus.health;
    }
  }
  b.log?.push(`join ${side.index === 0 ? 'P' : 'O'} teammate (${side.board.length} minions)`);
  if (side.board.length > 0) {
    startOfCombatForSide(b, side);
    resolveDeaths(b);
  }
  return side.board.length > 0;
}

function survivorDamage(b: Battle, side: SideState): number {
  let dmg = side.tavernTier;
  for (const m of aliveMinions(side)) dmg += m.tier > 0 ? m.tier : 1;
  const cap = b.input.damageCap;
  if (typeof cap === 'number' && cap > 0) dmg = Math.min(dmg, cap);
  return dmg;
}

export function runBattle(b: Battle): BattleOutcome {
  const [p, o] = b.sides;
  const pc = p.board.length;
  const oc = o.board.length;
  b.firstSide = pc > oc ? 0 : oc > pc ? 1 : b.rng.chance(0.5) ? 0 : 1;
  b.activeSide = b.firstSide;

  startOfCombat(b);
  resolveDeaths(b);

  let current = b.sides[b.firstSide];
  let tie = false;
  for (;;) {
    if (p.board.length === 0) joinTeammate(b, p);
    if (o.board.length === 0) joinTeammate(b, o);
    if (aliveCount(p) === 0 || aliveCount(o) === 0) break;
    if (b.attacks >= LIMITS.maxAttacks) {
      tie = true;
      break;
    }
    if (!takeTurn(b, current) && !sideCanAttack(current.opponent)) {
      tie = true; // neither side can attack: stalemate
      break;
    }
    current = current.opponent;
  }

  const pAlive = aliveCount(p);
  const oAlive = aliveCount(o);
  if (tie || (pAlive === 0 && oAlive === 0) || (pAlive > 0 && oAlive > 0)) return { result: 0, damage: 0 };
  if (pAlive > 0) return { result: 1, damage: survivorDamage(b, p) };
  return { result: -1, damage: survivorDamage(b, o) };
}
