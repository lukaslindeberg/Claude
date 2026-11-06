/**
 * Core data structures of the combat engine.
 *
 * Everything here is mutable and lives only for the duration of ONE simulated
 * combat: `Battle` is created from the (immutable) `BattleSimInput` for every
 * Monte Carlo iteration, so handlers may freely mutate minions and sides.
 */
import type { BattleSimInput, MinionSnapshot, Tribe } from '@shared/types';
import type { CardDb } from '../../cards/cardDb';
import type { Rng } from './rng';

export const MAX_BOARD = 7;

// ---------------------------------------------------------------------------
// Minions
// ---------------------------------------------------------------------------

/** A deathrattle attached to a minion that does not come from its own card. */
export interface GrantedDeathrattle {
  /** Card id the deathrattle comes from (enchantment, hero power, copied minion...). */
  sourceCardId: string;
  /** Golden-ness of the source (copied deathrattles keep their source's value). */
  golden: boolean;
  fn: DeathrattleFn;
}

export interface Minion {
  /** Unique within one battle (snapshot entity id, or generated for summons). */
  entityId: number;
  cardId: string;
  name: string;
  golden: boolean;
  /** 1 for normal, 2 for golden: the usual "golden = doubled" multiplier. */
  mult: number;
  /** Tavern tier used for damage (tokens without tier count as 1). */
  tier: number;
  tribes: Tribe[];
  attack: number;
  health: number;
  maxHealth: number;

  taunt: boolean;
  divineShield: boolean;
  venomous: boolean;
  poisonous: boolean;
  windfury: boolean;
  megaWindfury: boolean;
  reborn: boolean;
  stealth: boolean;
  cleave: boolean;

  /** Marked for destruction (venomous, "destroy" effects). Removed in the next death phase. */
  destroyed: boolean;
  /** Removed from the board (dead). */
  removed: boolean;
  /** Owner. */
  side: SideState;
  handler: CardHandler | undefined;
  /** Deathrattles granted by enchantments, hero powers, trinkets, Fish of N'Zoth... */
  extraDeathrattles: GrantedDeathrattle[];
  /** Enchantment card ids carried from the snapshot (informational / for copies). */
  enchantments: string[];
  /** Progress of this minion's own Avenge counter. */
  avengeProgress: number;
  /** Per-minion scratch space for handlers (e.g. "3 times per combat"). Null until used. */
  counters: Record<string, number> | null;
  /** Tags from the snapshot (read-only; TAG_SCRIPT_DATA_NUM_1 etc). */
  tags: Record<string, number>;
  /** Minion that dealt the fatal damage / destroyed this minion. */
  killedBy: Minion | null;
  /** Aura bonuses currently applied by `recalcAuras`. */
  auraAttack: number;
  auraHealth: number;
  /** True for the Aberration Deity once awakened. */
  isDeity: boolean;
  /** Snapshot this minion was built from, if any (used for "copy"/"plain copy" effects). */
  snapshot: MinionSnapshot | null;
  /** Minions remembered by a handler (e.g. Stitched Salvager's destroyed neighbours). */
  stash: Minion[] | null;
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/** Where a summon goes: the slot of a dead minion, or to the right of a living one. */
export interface SummonAnchor {
  side: SideState;
  /** Board index used for the next insert (dead-minion slots are kept up to date by the board helpers). */
  slot: number;
  /** Ordering key among simultaneous deaths (-1 for anchors not tied to a death). */
  order: number;
  /** For anchors next to a living minion: insert right of this minion. */
  rightOf: Minion | null;
  /** How many minions were inserted through this anchor so far. */
  inserted: number;
}

export interface DeadRecord extends SummonAnchor {
  minion: Minion;
  /** Board index the minion had when it died (before removals of this batch). */
  originalIndex: number;
}

/** A card kept in hand during combat (only minions matter to the simulator). */
export interface HandMinion {
  cardId: string;
  attack: number;
  health: number;
  golden: boolean;
  tribes: Tribe[];
  snapshot: MinionSnapshot;
}

/** A queued "When you have space, summon ..." effect. */
export interface SpaceSummon {
  remaining: number;
  /** Produce the minion to summon; return null to cancel the remaining summons. */
  make: (b: Battle, side: SideState) => Minion | null;
  /** Called after the minion is on the board (e.g. "it attacks immediately"). */
  after?: (b: Battle, m: Minion) => void;
}

/** A flat buff applied to minions summoned later this combat (Humming Bird, Goldrinn...). */
export interface SummonBuff {
  /** Only minions of this tribe (undefined = all). */
  tribe?: Tribe;
  attack: number;
  health: number;
  taunt?: boolean;
}

export interface DeityState {
  cardId: string;
  golden: boolean;
  attack: number;
  health: number;
  /** Friendly Aberration deaths needed to awaken it this combat. */
  threshold: number;
  progress: number;
  awakened: boolean;
  minion: Minion | null;
}

export interface SideState {
  /** 0 = player (us), 1 = opponent. */
  index: 0 | 1;
  board: Minion[];
  opponent: SideState;
  /** Next attacker pointer (board index; wraps around). */
  attackPtr: number;
  /** Minion that attacked last on this side (used by the pointer bookkeeping). */
  lastAttacker: Minion | null;
  /** Pointer tie-break used while a death batch is being resolved (-1 = none). */
  ptrTie: number;
  /** Death records of the batch being resolved (their slots are kept up to date). */
  pendingRecords: DeadRecord[];

  tavernTier: number;
  heroHealth: number;
  heroArmor: number;
  heroCardId: string;
  heroPowerCardId?: string;
  heroPowerUsed: boolean;
  heroPowerData: { scriptData1?: number; scriptData2?: number };
  playerTags: Record<string, number>;
  heroTags: Record<string, number>;
  hand: HandMinion[];

  /** Hero power / trinket / quest reward / anomaly / temporary side-level listeners. */
  effects: EffectInstance[];
  /** Minions that died this combat (in death order). */
  deadThisCombat: Minion[];
  friendlyDeaths: number;
  spaceQueue: SpaceSummon[];
  summonBuffs: SummonBuff[];

  // Player-level counters (initialised from playerTags, see engine/constants.ts)
  bloodGemAttack: number;
  bloodGemHealth: number;
  /** Extra stats given by Tavern spells cast in combat. */
  spellAttackBonus: number;
  spellHealthBonus: number;
  beetleAttack: number;
  beetleHealth: number;
  undeadAttackBonus: number;
  eternalKnightsDead: number;
  deathrattlesTriggered: number;
  spellsCastThisCombat: number;
  deity: DeityState | null;
  /** Start of Combat minion effects trigger this many times (Valdrakken Wind Chimes). */
  socMultiplier: number;
  /** Extra Deathrattle triggers (Titus is computed live; this holds rewards/anomalies). */
  extraDeathrattleTriggers: number;
  /** Extra triggers for the NEXT deathrattle minion only (Deathly Phylactery). */
  nextDeathrattleBonus: number;
  /** Extra triggers for the next Start of Combat minion effect only (Promo Portrait). */
  nextStartOfCombatBonus: number;
  /** Duos: the teammate waiting to join when this board is exhausted. */
  teammate: TeammateState | null;
}

export interface TeammateState {
  minions: MinionSnapshot[];
  tavernTier: number;
  heroCardId: string;
  heroHealth: number;
  heroArmor: number;
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

export interface Battle {
  rng: Rng;
  db: CardDb;
  input: BattleSimInput;
  sides: [SideState, SideState];
  /** Side index that attacked first. */
  firstSide: 0 | 1;
  /** Side index currently attacking (deaths of this side resolve first). */
  activeSide: 0 | 1;
  nextEntityId: number;
  recordSeq: number;
  resolvingDeaths: boolean;
  /** Re-entrancy depth for chains (blood gem ping-pong etc.). */
  depth: number;
  /** Any aura-providing minion present (enables recalcAuras). */
  hasAuras: boolean;
  /** Number of attacks performed (loop guard). */
  attacks: number;
  /** Optional debug log (only filled when enabled). */
  log: string[] | null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export interface DeathContext {
  /** Summon anchor: summons go to the dead minion's slot (or right of a living minion). */
  anchor: SummonAnchor;
  /** Killer of the minion (if known). */
  killer: Minion | null;
  /** Golden-ness of the deathrattle's source card. */
  golden: boolean;
  /** 1 or 2 (golden). */
  mult: number;
  /** True when the minion is not actually dead (deathrattle triggered by another effect). */
  artificial: boolean;
}

export type DeathrattleFn = (b: Battle, self: Minion, ctx: DeathContext) => void;

export interface AttackInfo {
  attacker: Minion;
  target: Minion;
  /** Target died from this attack. */
  killed: boolean;
  /** Damage beyond what was needed to kill the target (0 if none). */
  excess: number;
  /** The target's board index when attacked (for "adjacent" effects). */
  targetIndex: number;
}

/**
 * Behaviour of a minion card. Every hook is optional. `self` is the minion that
 * carries the handler. Golden minions use the same handler: read `self.mult`
 * (1/2) or `self.golden`.
 */
export interface CardHandler {
  /** Called once when the minion is created (from snapshot or summon). Set static flags here. */
  init?(b: Battle, self: Minion): void;
  /** Called after this minion was summoned during combat (not for the initial board). */
  onSummoned?(b: Battle, self: Minion): void;
  startOfCombat?(b: Battle, self: Minion): void;
  /** Start of Combat effect of a card while it is in the hand (Flighty Scout). */
  handStartOfCombat?(b: Battle, card: HandMinion, side: SideState): void;
  deathrattle?: DeathrattleFn;
  /** Avenge (X): number of friendly deaths needed (may depend on golden-ness). */
  avenge?: number | ((self: Minion) => number);
  onAvenge?(b: Battle, self: Minion): void;
  /** Rally / "Whenever this attacks": before damage. */
  rally?(b: Battle, self: Minion, target: Minion): void;
  /** Whenever a friendly minion (including this one) attacks, before damage. Check `attacker !== self` for "another". */
  onFriendlyAttack?(b: Battle, self: Minion, attacker: Minion, target: Minion): void;
  /** After this minion attacked (only if it survived the damage step). */
  afterAttack?(b: Battle, self: Minion, info: AttackInfo): void;
  /** After any friendly minion (including this one) attacked. */
  afterFriendlyAttack?(b: Battle, self: Minion, info: AttackInfo): void;
  /** Whenever this takes damage (also when the damage is fatal). */
  onDamaged?(b: Battle, self: Minion, amount: number, source: Minion | null): void;
  /** After a friendly minion (not this) dealt damage. */
  onFriendlyDealtDamage?(b: Battle, self: Minion, dealer: Minion, target: Minion, amount: number): void;
  onDivineShieldChanged?(b: Battle, self: Minion, hasShield: boolean): void;
  /** After a friendly minion (including this one) lost Divine Shield. */
  onFriendlyDivineShieldLost?(b: Battle, self: Minion, lost: Minion): void;
  onFriendlyDeath?(b: Battle, self: Minion, dead: Minion): void;
  /** Bookkeeping when this minion itself dies (before Avenge/Deathrattles). */
  onSelfDeath?(b: Battle, self: Minion): void;
  onEnemyDeath?(b: Battle, self: Minion, dead: Minion): void;
  /** "Whenever you summon": before "after" triggers. Not called for self. */
  onFriendlySummon?(b: Battle, self: Minion, summoned: Minion): void;
  /** "After you summon". Not called for self. */
  afterFriendlySummon?(b: Battle, self: Minion, summoned: Minion): void;
  /** After a friendly minion was Reborn. */
  onFriendlyReborn?(b: Battle, self: Minion, reborn: Minion): void;
  /** Whenever this kills a minion (attack or effect damage). */
  onKill?(b: Battle, self: Minion, victim: Minion, excess: number): void;
  /** After a friendly Deathrattle triggered (source = the minion whose deathrattle it was). */
  onDeathrattleTriggered?(b: Battle, self: Minion, source: Minion): void;
  /** After a Blood Gem was played on this minion. */
  onBloodGem?(b: Battle, self: Minion): void;
  /** After this minion's stats changed through `buff`. */
  onStatsChanged?(b: Battle, self: Minion): void;
  /** Whenever its owner casts a (Tavern) spell in combat. */
  onSpellCast?(b: Battle, self: Minion, spellId: string, target: Minion | null): void;
  /** Static aura: bonus this minion grants to `target` (recomputed on board changes). */
  aura?(b: Battle, self: Minion, target: Minion): { attack: number; health: number } | null;
  /** Set when the card has no combat effect beyond keywords (prevents "unsupported" flags). */
  noCombatEffect?: boolean;
}

/** A side-level effect: hero power, trinket, quest reward, anomaly or temporary listener. */
export type EffectKind = 'heroPower' | 'questReward' | 'trinket' | 'anomaly' | 'listener';

export interface EffectInstance {
  cardId: string;
  kind: EffectKind;
  handler: EffectHandler;
  side: SideState;
  /** Avenge progress. */
  progress: number;
  scriptData1?: number;
  scriptData2?: number;
  /** Scratch space. */
  data: Record<string, number>;
  /** Minions remembered by the effect (e.g. Soul Fermenter). */
  stash?: Minion[];
}

export interface EffectHandler {
  /** Called once when the battle is created (static modifiers such as extra Deathrattle triggers). */
  init?(b: Battle, e: EffectInstance): void;
  startOfCombat?(b: Battle, e: EffectInstance): void;
  avenge?: number | ((e: EffectInstance) => number);
  onAvenge?(b: Battle, e: EffectInstance): void;
  onFriendlyDeath?(b: Battle, e: EffectInstance, dead: Minion): void;
  onFriendlyAttack?(b: Battle, e: EffectInstance, attacker: Minion, target: Minion): void;
  afterFriendlyAttack?(b: Battle, e: EffectInstance, info: AttackInfo): void;
  onFriendlySummon?(b: Battle, e: EffectInstance, summoned: Minion): void;
  afterFriendlySummon?(b: Battle, e: EffectInstance, summoned: Minion): void;
  onFriendlyReborn?(b: Battle, e: EffectInstance, reborn: Minion): void;
  onDeathrattleTriggered?(b: Battle, e: EffectInstance, source: Minion): void;
  /** After the last friendly minion died (board empty). */
  onBoardEmpty?(b: Battle, e: EffectInstance): void;
  /** After this side's Deity awakened (was summoned). */
  onDeityAwakened?(b: Battle, e: EffectInstance, deity: Minion): void;
  noCombatEffect?: boolean;
}

/** Handler for an enchantment card id found on a minion snapshot. */
export interface EnchantmentHandler {
  /** Deathrattle granted by the enchantment. */
  deathrattle?: DeathrattleFn;
  /** Called when a minion carrying this enchantment is created. */
  init?(b: Battle, self: Minion): void;
}
