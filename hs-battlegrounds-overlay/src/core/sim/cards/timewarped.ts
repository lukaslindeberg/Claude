/**
 * Timewarped minions (patch 37.0.2, `timewarped: true` / BACON_TIMEWARPED): stronger variants of
 * older minions offered by the Timewarp. Numbers come from the card text / script data; golden
 * versions use the golden card's own values.
 *
 * Registered elsewhere: Timewarped Nest Swarmer (beast.ts), Timewarped Radio Star (undead.ts).
 * Timewarped Deios is handled by the engine (deathrattle / rally multipliers, like Titus).
 *
 * Deliberately NOT registered (reported as unsupported, see README):
 *   BG34_Giant_590  Timewarped Festergut     - "Undead Creations" are custom-built minions whose parts
 *                                              are not in the card data
 * Timewarped Greenskeeper is registered in battlecries.ts (it triggers a Battlecry).
 */
import { LOBBY_TRIBES, type Tribe } from '@shared/types';
import { registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  buffAll,
  castSpell,
  copyMinion,
  counter,
  dealDamage,
  giveDivineShield,
  giveReborn,
  giveTaunt,
  giveWindfury,
  handMinions,
  hasDeathrattle,
  hasTribe,
  highestBy,
  highestInHand,
  improveUndeadAttack,
  indexOf,
  isAlive,
  neighbours,
  playBloodGem,
  randomFriendlies,
  randomFriendly,
  randomPoolMinion,
  sd,
  setCounter,
  summonForDeath,
  summonFromHand,
  tribeFilter,
  triggerDeathrattlesArtificially,
  addBloodGemStats,
  bloodGemStats,
  minionFromSnapshot,
  summon,
} from './helpers';
import { avengeGetsCards, cardsAddedToHand, getsCards, type HandAddHandler } from './aberration';
import { magnetize, type MagnetHandler } from './mech';
import { makeGolden } from './neutral';
import { IMMUNE_WHILE_ATTACKING } from '../engine/attack';
import { recalcAuras } from '../engine/auras';
import { anchorIndex } from '../engine/board';
import { FULL_REBORN } from '../engine/minion';
import type { Battle, CardHandler, DeathContext, DeathrattleFn, HandMinion, Minion, SideState } from '../engine/types';

const isBeast = tribeFilter('BEAST');
const isDragon = tribeFilter('DRAGON');
const isMech = tribeFilter('MECHANICAL');
const isMurloc = tribeFilter('MURLOC');
const isPirate = tribeFilter('PIRATE');
const isQuilboar = tribeFilter('QUILBOAR');
const isUndead = tribeFilter('UNDEAD');

const SKELETON = 'BG_ICC_026t';
const IMP = 'BG_BRM_006t';
const BLOOD_GEM_BARRAGE = 'BG34_689';

const LEAPFROGGER = 'BG34_Giant_031';
const WARGHOUL = 'BG34_Giant_331';
const WHIRL_O_TRON = 'BG34_Giant_599';
const STONESHELL = 'BG34_Giant_601';
const MYTHRAX = 'BG34_Giant_684';

function isCard(b: Battle, m: Minion, normalId: string): boolean {
  return m.cardId === normalId || b.db.normalOf(m.cardId) === normalId;
}

/** "Give a friendly minion of each type +X/+Y": one random minion per tribe, each minion at most once. */
function buffEachType(b: Battle, side: SideState, attack: number, health: number): void {
  const used = new Set<Minion>();
  for (const tribe of LOBBY_TRIBES) {
    const t = randomFriendly(b, side, (m) => !used.has(m) && m.tribes.length > 0 && hasTribe(m, tribe));
    if (!t) continue;
    used.add(t);
    buff(b, t, attack, health);
  }
}

/** Buff a card in hand (the snapshot is replaced, never mutated, so later hand summons carry it). */
function buffHandCard(h: HandMinion, attack: number, health: number): void {
  h.attack += attack;
  h.health += health;
  h.snapshot = { ...h.snapshot, attack: h.attack, health: h.health, maxHealth: h.health };
}

/** "Double" (k = 2) / "triple" (k = 3) a minion's current stats. */
function multiplyStats(b: Battle, m: Minion, k: number): void {
  buff(b, m, m.attack * (k - 1), m.health * (k - 1));
}

// ---------------------------------------------------------------------------
// Copied effects (Whirl-O-Tron, Stoneshell): a copied Deathrattle / Rally keeps the script data
// and golden-ness of the minion it was copied from, but acts for its new owner.
// ---------------------------------------------------------------------------

interface SourceData {
  tags: Record<string, number>;
  golden: boolean;
  mult: number;
}

function sourceData(b: Battle, src: Minion): SourceData {
  const card = b.db.get(src.cardId)?.tags as Record<string, number> | undefined;
  return { tags: { ...card, ...src.tags }, golden: src.golden, mult: src.mult };
}

/** Run `fn` while `self` reads the script data / golden-ness of the effect's source. */
function asSource(self: Minion, d: SourceData, fn: () => void): void {
  const { tags, golden, mult } = self;
  self.tags = d.tags;
  self.golden = d.golden;
  self.mult = d.mult;
  try {
    fn();
  } finally {
    self.tags = tags;
    self.golden = golden;
    self.mult = mult;
  }
}

/** Living minions next to a (possibly dead) minion: its old slot for real deaths. */
function adjacentTo(self: Minion, ctx: DeathContext): Minion[] {
  if (indexOf(self) >= 0) return neighbours(self);
  const board = self.side.board;
  const i = anchorIndex(ctx.anchor);
  const out: Minion[] = [];
  for (let j = i - 1; j >= 0; j--) {
    if (isAlive(board[j])) {
      out.push(board[j]);
      break;
    }
  }
  for (let j = i; j < board.length; j++) {
    if (isAlive(board[j])) {
      out.push(board[j]);
      break;
    }
  }
  return out;
}

/** Timewarped Leapfrogger: Deathrattle: Give a friendly Beast +1/+1 and this Deathrattle (golden +2/+2). */
const leapfrog: DeathrattleFn = (b, self, ctx) => {
  const t = randomFriendly(b, self.side, isBeast, ctx.artificial ? null : self);
  if (!t) return;
  buff(b, t, ctx.mult, ctx.mult);
  t.extraDeathrattles.push({ sourceCardId: ctx.golden ? `${LEAPFROGGER}_G` : LEAPFROGGER, golden: ctx.golden, fn: leapfrog });
};

/** Timewarped Boars that died this combat, per side ("every third ... dies"). */
const boarsDead = new WeakMap<SideState, number>();

export function registerTimewarped(): void {
  // =========================================================================
  // Deathrattles
  // =========================================================================

  // Timewarped Trickster (T5): Deathrattle: Give this minion's maximum stats to another friendly
  // minion (golden: twice).
  registerMinion('BG34_Giant_010', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const t = randomFriendly(b, self.side, undefined, self);
        if (t) buff(b, t, self.attack, self.maxHealth);
      }
    },
  });

  // Timewarped Scourfin (T3): Taunt. Deathrattle: Give a random minion in your hand +7/+7 and summon
  // it for this combat only (golden +14/+14).
  registerMinion('BG34_Giant_017', {
    deathrattle: (b, self, ctx) => {
      const card = b.rng.pick(handMinions(b, self.side));
      if (!card) return;
      buffHandCard(card, sd(b, self, 1, 7 * ctx.mult), sd(b, self, 2, 7 * ctx.mult));
      summonFromHand(b, self.side, card, ctx.anchor);
    },
  });

  // Timewarped Leapfrogger (T3): Taunt, Reborn. Deathrattle: Give a friendly Beast +1/+1 and this Deathrattle.
  registerMinion(LEAPFROGGER, { deathrattle: leapfrog });

  // Timewarped Geist (T5): Deathrattle: Your Tavern spells give an extra +2/+2 this game (golden +4/+4).
  registerMinion('BG34_Giant_034', {
    deathrattle: (b, self, ctx) => {
      self.side.spellAttackBonus += sd(b, self, 1, 2 * ctx.mult);
      self.side.spellHealthBonus += sd(b, self, 2, 2 * ctx.mult);
    },
  });

  // Timewarped Bassgill (T3): Deathrattle: Summon the highest-Health minion from your hand and give
  // it Divine Shield for this combat only (golden: the 2 highest).
  registerMinion('BG34_Giant_071', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const card = highestInHand(b, self.side, 'health');
        const m = card && summonFromHand(b, self.side, card, ctx.anchor);
        if (!m) break;
        giveDivineShield(b, m);
      }
    },
  });

  // Timewarped Jazzer (T3): Deathrattle: Your Blood Gems give an extra +2 Health this game (golden +4).
  registerMinion('BG34_Giant_306', {
    deathrattle: (b, self, ctx) => void (self.side.bloodGemHealth += sd(b, self, 2, 2 * ctx.mult)),
  });

  // Timewarped Tide Razor (T5): Deathrattle: Summon and get 4 random Pirates (golden 8).
  registerMinion('BG34_Giant_328', {
    deathrattle: (b, self, ctx) => {
      const n = sd(b, self, 1, 4 * ctx.mult);
      for (let i = 0; i < n; i++) {
        const card = randomPoolMinion(b, 'pirate', (c) => c.tribes.includes('PIRATE'));
        if (!card || !summonForDeath(b, self, ctx, card.id, 1).length) break;
      }
      cardsAddedToHand(b, self.side, n);
    },
  });

  // Timewarped Nellie's Ship (T3): At the start of each turn, Discover a Pirate to crew the ship.
  // Deathrattle: Summon and get that Pirate (golden: 2). Which Pirate was Discovered is not in the input:
  // modelled as a random Pirate of the owner's Tavern Tier or lower.
  registerMinion('BG34_Giant_074t', {
    deathrattle: (b, self, ctx) => {
      const tier = self.side.tavernTier || 6;
      for (let i = 0; i < ctx.mult; i++) {
        const card = randomPoolMinion(b, `pirate<=${tier}`, (c) => c.tribes.includes('PIRATE') && (c.tier ?? 1) <= tier);
        if (card) summonForDeath(b, self, ctx, card.id, 1);
      }
      cardsAddedToHand(b, self.side, ctx.mult);
    },
  });

  // Timewarped Bristler (T5): Deathrattle: Give this minion's Blood Gems to 2 different friendly Quilboar
  // (golden: twice). "Its Blood Gems" = the stats it got from Blood Gems (BG20_GEMe2 + gems this combat);
  // they are given as stats (no "when a Blood Gem is played" triggers).
  registerMinion('BG34_Giant_104', {
    deathrattle: (b, self, ctx) => {
      const gems = bloodGemStats(self);
      if (gems.attack <= 0 && gems.health <= 0) return;
      const n = sd(b, self, 1, 2);
      for (let i = 0; i < ctx.mult; i++) {
        for (const t of randomFriendlies(b, self.side, n, (m) => m !== self && hasTribe(m, 'QUILBOAR'))) {
          buff(b, t, gems.attack, gems.health);
          addBloodGemStats(t, gems.attack, gems.health);
        }
      }
    },
  });

  // Timewarped Magnanimoose (T5): Deathrattle: Summon and get a minion from a random opponent's warband
  // (golden: twice). Only the current opponent's warband is known: a random minion of its board at the
  // start of combat (snapshot stats).
  registerMinion('BG34_Giant_619', {
    deathrattle: (b, self, ctx) => {
      const opp = self.side.index === 0 ? b.input.opponent : b.input.player;
      const pool = (opp?.minions ?? []).filter((s) => s.cardId !== 'BG34_Giant_619' && s.cardId !== 'BG34_Giant_619_G');
      for (let i = 0; i < ctx.mult; i++) {
        const snap = b.rng.pick(pool);
        if (!snap) break;
        const m = minionFromSnapshot(b, self.side, { ...snap, entityId: b.nextEntityId++ });
        summon(b, self.side, m, ctx.anchor);
      }
      cardsAddedToHand(b, self.side, Math.min(ctx.mult, pool.length));
    },
  });

  // Timewarped Stone Drake (T5): Start of Combat: Gain the stats of all the minions you sold this turn
  // (golden: double). The shown (X/X) is the minion's script data 1/2 (assumed to include the doubling).
  registerMinion('BG34_Giant_675', {
    startOfCombat: (b, self) => {
      const a = sd(b, self, 1, 0);
      const h = sd(b, self, 2, 0);
      if (a > 0 || h > 0) buff(b, self, a, h);
    },
  });

  // Timewarped Warghoul (T5): Taunt. Deathrattle: Trigger an adjacent minion's Deathrattle (golden:
  // adjacent minions' Deathrattles), except Timewarped Warghoul.
  registerMinion(WARGHOUL, {
    deathrattle: (b, self, ctx) => {
      const adj = adjacentTo(self, ctx).filter((m) => hasDeathrattle(m) && !isCard(b, m, WARGHOUL));
      const picked = ctx.golden ? adj : adj.length > 1 ? [b.rng.pick(adj)!] : adj;
      for (const m of picked) if (isAlive(m)) triggerDeathrattlesArtificially(b, m, 1);
    },
  });

  // Timewarped Goldrinn (T5): Deathrattle: Your Beasts have +4/+4 this game, wherever they are (golden +8/+8).
  registerMinion('BG34_Giant_362', {
    deathrattle: (b, self, ctx) => {
      const a = sd(b, self, 1, 4 * ctx.mult);
      const h = sd(b, self, 2, 4 * ctx.mult);
      buffAll(b, self.side, a, h, isBeast);
      self.side.summonBuffs.push({ tribe: 'BEAST', attack: a, health: h });
    },
  });

  // Timewarped Spirit of Air (T3): Deathrattle: Give a random friendly minion Windfury, Divine
  // Shield, and Taunt (golden: 2 minions).
  registerMinion('BG34_Giant_592', {
    deathrattle: (b, self, ctx) => {
      for (const t of randomFriendlies(b, self.side, ctx.mult, undefined, self)) {
        giveWindfury(t);
        giveDivineShield(b, t);
        giveTaunt(t);
      }
    },
  });

  // Timewarped Lil' Quilboar (T5): Reborn. Deathrattle: This plays 3 Blood Gems on all your Quilboar (golden 6).
  registerMinion('BG34_Giant_608', {
    deathrattle: (b, self, ctx) => {
      const n = sd(b, self, 1, 3 * ctx.mult);
      for (const m of aliveMinions(self.side)) if (isQuilboar(m)) playBloodGem(b, m, n);
    },
  });

  // Timewarped Caretaker (T5): Deathrattle: Summon five 1/1 Skeletons (golden: ten). Any that don't
  // fit give your Undead +1 Attack this game, wherever they are.
  registerMinion('BG34_Giant_618', {
    deathrattle: (b, self, ctx) => {
      const n = 5 * ctx.mult;
      const missing = n - summonForDeath(b, self, ctx, SKELETON, n).length;
      if (missing > 0) improveUndeadAttack(b, self.side, sd(b, self, 1, 1) * missing);
    },
  });

  // Timewarped Icky Imp (T5): Deathrattle: Summon 2 Imps with this minion's maximum stats (golden 4).
  registerMinion('BG34_Giant_674', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, IMP, 2 * ctx.mult, { attack: self.attack, health: self.maxHealth, tier: 1 });
    },
  });

  // =========================================================================
  // Start of Combat
  // =========================================================================

  // Timewarped Dragonling (T3): Start of Combat: Give this minion and its neighbors stats equal to
  // your Tier (golden: twice your Tier).
  registerMinion('BG34_Giant_029', {
    startOfCombat: (b, self) => {
      const x = self.side.tavernTier * self.mult;
      for (const m of [self, ...neighbours(self)]) buff(b, m, x, x);
    },
  });

  // Timewarped Chameleon (T5): Start of Combat: Transform into a copy of the minion to the left of
  // this (golden: a Golden copy).
  registerMinion('BG34_Giant_042', {
    startOfCombat: (b, self) => {
      const side = self.side;
      const i = side.board.indexOf(self);
      let left: Minion | undefined;
      for (let j = i - 1; j >= 0 && !left; j--) if (isAlive(side.board[j])) left = side.board[j];
      if (i < 0 || !left) return;
      const copy = copyMinion(b, left);
      if (self.golden) makeGolden(b, copy);
      side.board[i] = copy;
      self.removed = true;
      if (side.lastAttacker === self) side.lastAttacker = copy;
      if (copy.handler?.aura) b.hasAuras = true;
      if (b.hasAuras) recalcAuras(b);
    },
  });

  // Timewarped Promo-Drake (T5): Start of Combat: Give your minions +X/+X (X = script data 4: 5,
  // golden 10; improves each turn).
  registerMinion('BG34_Giant_088', {
    startOfCombat: (b, self) => {
      const x = sd(b, self, 4, 5 * self.mult);
      buffAll(b, self.side, x, x);
    },
  });

  // Timewarped Red Whelp (T3): Start of Combat: Deal 3 damage to two random enemy minions
  // (golden card: 2 damage to four). The damage is script data 1 (improves after playing a Dragon).
  registerMinion('BG34_Giant_091', {
    startOfCombat: (b, self) => {
      const dmg = sd(b, self, 1, self.golden ? 2 : 3);
      for (const t of b.rng.sample(aliveMinions(self.side.opponent), 2 * self.mult)) dealDamage(b, self, t, dmg);
    },
  });

  // Timewarped Mrrrglr (T5): Start of Combat: Give adjacent Murlocs the stats of all the minions in
  // your hand (golden: twice).
  registerMinion('BG34_Giant_321', {
    startOfCombat: (b, self) => {
      let a = 0;
      let h = 0;
      for (const c of handMinions(b, self.side)) {
        a += c.attack;
        h += c.health;
      }
      if (!a && !h) return;
      for (const n of neighbours(self)) if (isMurloc(n)) buff(b, n, a * self.mult, h * self.mult);
    },
  });

  // Timewarped Hag (T5): Start of Combat: Give the Undead to the right (golden: adjacent Undead)
  // Reborn and "This is Reborn with full Health and enchantments".
  registerMinion('BG34_Giant_342', {
    startOfCombat: (_b, self) => {
      const i = self.side.board.indexOf(self);
      for (const t of neighbours(self)) {
        if (!isUndead(t) || (!self.golden && self.side.board.indexOf(t) < i)) continue;
        giveReborn(t);
        setCounter(t, FULL_REBORN, 1);
      }
    },
  });

  // Timewarped Hawkstrider (T5): Start of Combat: Trigger all friendly Deathrattles (golden: twice).
  registerMinion('BG34_Giant_370', {
    startOfCombat: (b, self) => {
      for (const m of aliveMinions(self.side)) {
        if (hasDeathrattle(m) && isAlive(m)) triggerDeathrattlesArtificially(b, m, self.mult);
      }
    },
  });

  // Timewarped Ragnaros (T3): Start of Combat: Deal this minion's Attack (golden: double) to the
  // highest-Health enemy minion.
  registerMinion('BG34_Giant_580', {
    startOfCombat: (b, self) => {
      const t = highestBy(b, aliveMinions(self.side.opponent), (m) => m.health);
      if (t) dealDamage(b, self, t, self.attack * self.mult);
    },
  });

  // Timewarped Immortal (T5): Start of Combat: Gain the stats of adjacent minions (golden: double).
  registerMinion('BG34_Giant_597', {
    startOfCombat: (b, self) => {
      let a = 0;
      let h = 0;
      for (const n of neighbours(self)) {
        a += n.attack;
        h += n.health;
      }
      if (a || h) buff(b, self, a * self.mult, h * self.mult);
    },
  });

  // Timewarped Whirl-O-Tron (T5): Start of Combat: Copy your two left-most Deathrattles (golden:
  // twice), except other Whirl-O-Trons.
  registerMinion(WHIRL_O_TRON, {
    startOfCombat: (b, self) => {
      const sources = aliveMinions(self.side)
        .filter((m) => m !== self && !isCard(b, m, WHIRL_O_TRON) && hasDeathrattle(m))
        .slice(0, 2);
      for (let r = 0; r < self.mult; r++) {
        for (const src of sources) {
          const own = src.handler?.deathrattle;
          if (own) {
            const data = sourceData(b, src);
            self.extraDeathrattles.push({
              sourceCardId: src.cardId,
              golden: src.golden,
              fn: (bb, me, ctx) => asSource(me, data, () => own(bb, me, ctx)),
            });
          }
          for (const g of src.extraDeathrattles.slice()) self.extraDeathrattles.push(g);
        }
      }
    },
  });

  // Timewarped Stoneshell (T5): Start of Combat: Copy all friendly Rallies (golden: twice), except
  // other Stoneshells. The copies are attached as a per-minion handler with a `rally`.
  const stoneshell: CardHandler = {
    startOfCombat: (b, self) => {
      const copied: { fn: NonNullable<CardHandler['rally']>; data: SourceData }[] = [];
      for (const src of aliveMinions(self.side)) {
        const fn = src.handler?.rally;
        if (src === self || !fn || isCard(b, src, STONESHELL)) continue;
        const data = sourceData(b, src);
        for (let r = 0; r < self.mult; r++) copied.push({ fn, data });
      }
      if (!copied.length) return;
      const base = self.handler ?? stoneshell;
      const prev = base.rally;
      self.handler = {
        ...base,
        rally: (bb, me, target) => {
          prev?.(bb, me, target);
          for (const c of copied) asSource(me, c.data, () => c.fn(bb, me, target));
        },
      };
    },
  };
  registerMinion(STONESHELL, stoneshell);

  // Timewarped Mythrax (T5, all types): Start of Combat: Gain the stats (golden: twice) of 3 friendly
  // minions of different types, except Timewarped Mythrax.
  registerMinion(MYTHRAX, {
    startOfCombat: (b, self) => {
      const pool = aliveMinions(self.side).filter((m) => m !== self && m.tribes.length > 0 && !isCard(b, m, MYTHRAX));
      const used = new Set<Tribe>();
      let a = 0;
      let h = 0;
      let picked = 0;
      for (const m of b.rng.sample(pool, pool.length)) {
        const options = (m.tribes.includes('ALL') ? LOBBY_TRIBES : m.tribes).filter((t) => !used.has(t));
        const tribe = b.rng.pick(options);
        if (!tribe) continue;
        used.add(tribe);
        a += m.attack;
        h += m.health;
        if (++picked >= 3) break;
      }
      if (picked) buff(b, self, a * self.mult, h * self.mult);
    },
  });

  // Timewarped Ultralisk (T5): Also damages adjacent minions. Start of Combat: Double (golden:
  // triple) this minion's stats.
  registerMinion('BG34_Treasure_994', {
    init: (_b, self) => void (self.cleave = true),
    startOfCombat: (b, self) => multiplyStats(b, self, self.golden ? 3 : 2),
  });

  // =========================================================================
  // Avenge
  // =========================================================================

  // Timewarped Geomancer (T3): Avenge (5): Get a Blood Gem. Your Blood Gems give an extra +1/+1 this
  // game (golden +2/+2).
  registerMinion('BG34_Giant_305', {
    avenge: 5,
    onAvenge: (b, self) => {
      self.side.bloodGemAttack += self.mult;
      self.side.bloodGemHealth += self.mult;
      cardsAddedToHand(b, self.side, 1);
    },
  });

  // Timewarped Duskmaw (T5): Avenge (1): Give your Dragons +6/+X (script data 2 / 3: 6/4, golden 12/8).
  registerMinion('BG34_PreMadeChamp_020', {
    avenge: 1,
    onAvenge: (b, self) => buffAll(b, self.side, sd(b, self, 2, 6 * self.mult), sd(b, self, 3, 4 * self.mult), isDragon),
  });

  // =========================================================================
  // Rally / attacks
  // =========================================================================

  // Timewarped Guard (T3): Divine Shield. Rally: Give a different friendly minion Divine Shield
  // permanently (golden: 2 different minions).
  registerMinion('BG34_Giant_068', {
    rally: (b, self) => {
      for (const t of randomFriendlies(b, self.side, self.mult, (m) => !m.divineShield, self)) giveDivineShield(b, t);
    },
  });

  // Timewarped Bonker (T5): Windfury. Rally: This plays 2 permanent Blood Gems on all your other
  // minions (golden 4).
  registerMinion('BG34_Giant_102', {
    rally: (b, self) => {
      const n = sd(b, self, 1, 2 * self.mult);
      for (const m of aliveMinions(self.side)) if (m !== self) playBloodGem(b, m, n);
    },
  });

  // Timewarped Sea Glass (T5): Divine Shield. Rally: Double (golden: triple) this minion's stats.
  // (2 times per combat.)
  registerMinion('BG34_Giant_110', {
    rally: (b, self) => {
      const left = counter(self, 'left', sd(b, self, 1, 2));
      if (left <= 0) return;
      setCounter(self, 'left', left - 1);
      multiplyStats(b, self, self.golden ? 3 : 2);
    },
  });

  // Timewarped Collector (T5): Also damages adjacent minions. Rally: If you control 4 Golden minions,
  // gain Divine Shield.
  registerMinion('BG34_Giant_680', {
    init: (_b, self) => void (self.cleave = true),
    rally: (b, self) => {
      let golden = 0;
      for (const m of aliveMinions(self.side)) if (m.golden) golden++;
      if (golden >= 4) giveDivineShield(b, self);
    },
  });

  // Timewarped Viper (T5): Venomous. Immune while attacking (engine: no damage from its target).
  registerMinion('BG34_Treasure_990', {
    init: (_b, self) => setCounter(self, IMMUNE_WHILE_ATTACKING, 1),
  });

  // Timewarped Arm (T3): Whenever a friendly minion is attacked, give it +8 Attack permanently (golden +16).
  registerMinion('BG34_Giant_027', {
    onFriendlyAttacked: (b, self, _attacker, target) => buff(b, target, sd(b, self, 1, 8 * self.mult), 0),
  });

  // Timewarped Murcules (T3): Divine Shield. Whenever this kills a minion, give the left-most minion
  // in your hand +4/+4 (golden +8/+8).
  registerMinion('BG34_Giant_207', {
    onKill: (b, self) => {
      const h = handMinions(b, self.side)[0];
      if (h) buffHandCard(h, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 4 * self.mult));
    },
  });

  // Timewarped Pagle (T3): Once per combat, when this attacks and kills a minion, get a Triple
  // Reward (golden: 2). Only the cards reaching the hand matter in combat.
  registerMinion('BG34_Giant_208', {
    onKill: (b, self) => {
      if (counter(self, 'done', 0) || b.sides[b.activeSide] !== self.side) return;
      setCounter(self, 'done', 1);
      cardsAddedToHand(b, self.side, self.mult);
    },
  });

  // =========================================================================
  // Damage, deaths, Divine Shields, Reborn
  // =========================================================================

  // Timewarped Piper (T3): Whenever this takes damage, your Blood Gems give an extra +1 Attack this
  // game (golden +2). (3 times per combat.)
  registerMinion('BG34_Giant_069', {
    onDamaged: (b, self) => {
      const left = counter(self, 'left', sd(b, self, 1, 3));
      if (left <= 0) return;
      setCounter(self, 'left', left - 1);
      self.side.bloodGemAttack += sd(b, self, 2, self.mult);
    },
  });

  // Timewarped Deathswarmer (T3): Whenever this takes damage, your Undead have +1 Attack this game,
  // wherever they are (golden +2).
  registerMinion('BG34_Giant_081', {
    onDamaged: (b, self) => improveUndeadAttack(b, self.side, sd(b, self, 1, self.mult)),
  });

  // Timewarped Chimera (T3, all types): Whenever this takes damage, give a friendly minion of each
  // type +2/+1 permanently (golden: twice).
  registerMinion('BG34_Giant_679', {
    onDamaged: (b, self) => {
      for (let i = 0; i < self.mult; i++) buffEachType(b, self.side, sd(b, self, 1, 2), sd(b, self, 2, 1));
    },
  });

  // Timewarped Hyena (T3): Whenever a friendly Beast dies, gain +2/+2 permanently (golden +4/+4).
  registerMinion('BG34_Giant_581', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead !== self && isBeast(dead)) buff(b, self, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 2 * self.mult));
    },
  });

  // Timewarped Boar (T3): Whenever every third friendly Timewarped Boar dies, get a random Golden
  // Beast (golden: 2). Only the cards reaching the hand matter; the count starts at 0 each combat.
  registerMinion('BG34_Giant_201', {
    onSelfDeath: (b, self) => {
      const n = (boarsDead.get(self.side) ?? 0) + 1;
      boarsDead.set(self.side, n);
      if (n % 3 === 0) cardsAddedToHand(b, self.side, self.mult);
    },
  });

  // Timewarped Henchman (T3): After you kill a second minion each combat, get a plain copy of it (golden: 2).
  registerMinion('BG34_Giant_593', {
    onEnemyDeath: (b, self) => {
      const n = counter(self, 'kills', 0) + 1;
      setCounter(self, 'kills', n);
      if (n === 2) cardsAddedToHand(b, self.side, self.mult);
    },
  });

  // Timewarped Gemsplitter (T5): Divine Shield. After a friendly minion loses Divine Shield, your
  // Blood Gems give an extra +1 Attack this game (golden +2).
  registerMinion('BG34_Giant_644', {
    onFriendlyDivineShieldLost: (b, self) => void (self.side.bloodGemAttack += sd(b, self, 1, self.mult)),
  });

  // Timewarped Grease Bot (T5): Divine Shield. After a friendly minion loses Divine Shield, give
  // your minions +3/+3 permanently (golden +6/+6).
  registerMinion('BG34_Giant_656', {
    onFriendlyDivineShieldLost: (b, self) => buffAll(b, self.side, sd(b, self, 1, 3 * self.mult), sd(b, self, 2, 3 * self.mult)),
  });

  // Timewarped Jelly Belly (T3): After a friendly minion is Reborn, give your minions +2/+2
  // permanently (golden +4/+4).
  registerMinion('BG34_Giant_024', {
    onFriendlyReborn: (b, self) => buffAll(b, self.side, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 2 * self.mult)),
  });

  // Timewarped Saurolisk (T3): After you trigger a Deathrattle, gain +3/+2 permanently (golden +6/+4).
  registerMinion('BG34_Giant_202', {
    onDeathrattleTriggered: (b, self) => buff(b, self, sd(b, self, 1, 3 * self.mult), sd(b, self, 2, 2 * self.mult)),
  });

  // Timewarped Ghoul-acabra (T5): After you trigger a Deathrattle, give your minions +3/+2
  // permanently (golden +6/+4).
  registerMinion('BG34_Giant_609', {
    onDeathrattleTriggered: (b, self) => buffAll(b, self.side, sd(b, self, 1, 3 * self.mult), sd(b, self, 2, 2 * self.mult)),
  });

  // =========================================================================
  // Summons
  // =========================================================================

  // Timewarped Embalmer (T3): One minion you summon each turn gains Reborn (golden: two). The
  // charges are script data 1 ("X left").
  registerMinion('BG34_Giant_332', {
    onFriendlySummon: (b, self, summoned) => {
      const left = counter(self, 'left', sd(b, self, 1, self.mult));
      if (left <= 0) return;
      setCounter(self, 'left', left - 1);
      giveReborn(summoned);
    },
  });

  // Timewarped Tamuzo (T5): After you summon a minion in combat, double (golden: triple) its stats.
  registerMinion('BG34_Giant_595', {
    afterFriendlySummon: (b, self, summoned) => multiplyStats(b, summoned, self.golden ? 3 : 2),
  });

  // Timewarped Deadstomper (T5): After you summon a minion, give your minions +4 Attack permanently (golden +8).
  registerMinion('BG34_Giant_654', {
    afterFriendlySummon: (b, self) => buffAll(b, self.side, sd(b, self, 1, 4 * self.mult), 0),
  });

  // Timewarped Jungle King (T5): Stealth. After you summon a Beast, give it +4/+3 (golden +8/+6).
  // ("Improves after you cast a spell" is not simulated within a combat.)
  registerMinion('BG34_PreMadeChamp_004', {
    afterFriendlySummon: (b, self, summoned) => {
      if (isBeast(summoned)) buff(b, summoned, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 3 * self.mult));
    },
  });

  // Timewarped Karathress (T5): After you summon a minion in combat, get a copy of Deep Blues (golden: 2).
  registerMinion('BG34_PreMadeChamp_056', {
    afterFriendlySummon: (b, self) => void cardsAddedToHand(b, self.side, self.mult),
  });

  // =========================================================================
  // Spells, Blood Gems, Magnetize, stat gains, hand
  // =========================================================================

  // Timewarped Hooktail (T5): Whenever you cast a Tavern spell, give your minions +2/+2 (golden: twice).
  registerMinion('BG34_Giant_015', {
    onSpellCast: (b, self) => {
      for (let i = 0; i < self.mult; i++) buffAll(b, self.side, sd(b, self, 1, 2), sd(b, self, 2, 2));
    },
  });

  // Timewarped Nalaa (T5): Whenever you cast a spell, give a friendly minion of each type +4/+3 (golden +8/+6).
  registerMinion('BG34_Giant_205', {
    onSpellCast: (b, self) => buffEachType(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 3 * self.mult)),
  });

  // Timewarped Lab Rat (T5): After you cast a spell, give your Beasts +2/+2 (golden +4/+4).
  registerMinion('BG34_PreMadeChamp_002', {
    onSpellCast: (b, self) => buffAll(b, self.side, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 2 * self.mult), isBeast),
  });

  // Timewarped Centurion (T5): After you cast a Tavern spell, get an extra copy of it (golden: 2).
  // (3 times per turn.) Only the cards reaching the hand matter in combat.
  registerMinion('BG34_PreMadeChamp_200', {
    onSpellCast: (b, self) => {
      const left = counter(self, 'left', sd(b, self, 2, 3));
      if (left <= 0) return;
      setCounter(self, 'left', left - 1);
      cardsAddedToHand(b, self.side, self.mult);
    },
  });

  // Timewarped Twirler (T5): After you play a Blood Gem on this, cast Blood Gem Barrage (golden:
  // twice). The Barrage only buffs the Tavern, but it is a Tavern spell cast in combat.
  registerMinion('BG34_Giant_105', {
    onBloodGem: (b, self) => {
      for (let i = 0; i < self.mult; i++) castSpell(b, self.side, BLOOD_GEM_BARRAGE);
    },
  });

  // Timewarped Interpreter (T5): Whenever you play or Magnetize a Mech, give your Mechs +3/+3
  // (golden +6/+6). In combat only Magnetizations happen (Glambot, Timewarped Electron).
  const interpreter: MagnetHandler = {
    onMagnetize: (b, self) => buffAll(b, self.side, sd(b, self, 1, 3 * self.mult), sd(b, self, 2, 3 * self.mult), isMech),
  };
  registerMinion('BG34_Giant_120', interpreter);

  // Timewarped Electron (T5): After you cast 2 Tavern spells, Magnetize a X/X Satellite to all your
  // Mechs (golden: twice). Script data: 1 = spells needed, 2 = spells left, 3/4 = Satellite stats.
  registerMinion('BG34_Giant_610', {
    onSpellCast: (b, self) => {
      const need = Math.max(1, sd(b, self, 1, 2));
      const left = counter(self, 'left', Math.max(1, Math.min(need, sd(b, self, 2, need)))) - 1;
      if (left > 0) return void setCounter(self, 'left', left);
      setCounter(self, 'left', need);
      const a = sd(b, self, 3, 4);
      const h = sd(b, self, 4, 4);
      for (let r = 0; r < self.mult; r++) {
        for (const m of aliveMinions(self.side)) if (isMech(m)) magnetize(b, m, a, h);
      }
    },
  });

  // Timewarped Whelp Smuggler (T3): Whenever a friendly minion gains Attack, give it +3 Health (golden +6).
  registerMinion('BG34_Giant_064', {
    init: (b) => void (b.watchAttackGain = true),
    onFriendlyGainedAttack: (b, self, target) => buff(b, target, 0, sd(b, self, 2, 3 * self.mult)),
  });

  // Timewarped Expeditioner (T5): Taunt, Divine Shield. After this gains stats, also give the stats
  // (golden: twice the stats) to the two left-most minions in your hand.
  registerMinion('BG34_Giant_317', {
    init: (_b, self) => {
      setCounter(self, 'atk', self.attack);
      setCounter(self, 'hp', self.maxHealth);
    },
    onStatsChanged: (b, self) => {
      const da = self.attack - counter(self, 'atk', self.attack);
      const dh = self.maxHealth - counter(self, 'hp', self.maxHealth);
      setCounter(self, 'atk', self.attack);
      setCounter(self, 'hp', self.maxHealth);
      if (da <= 0 && dh <= 0) return;
      for (const c of handMinions(b, self.side).slice(0, 2)) {
        buffHandCard(c, Math.max(0, da) * self.mult, Math.max(0, dh) * self.mult);
      }
    },
  });

  // Timewarped Peggy (T5): Whenever a card is added to your hand, give your Pirates +1/+1 (golden: twice).
  const peggy: HandAddHandler = {
    onCardsAddedToHand: (b, self, count) => {
      for (let i = 0; i < count * self.mult; i++) buffAll(b, self.side, sd(b, self, 1, 1), sd(b, self, 2, 1), isPirate);
    },
  };
  registerMinion('BG34_Giant_327', peggy);

  // Timewarped Lubber (T3): Your Tavern spells give an extra +1/+1 (golden +2/+2). Like Enchanted
  // Sentinel: the aura is part of the player's spell bonus while it is on the board.
  registerMinion('BG34_Giant_066', {
    onSummoned: (b, self) => {
      self.side.spellAttackBonus += sd(b, self, 1, self.mult);
      self.side.spellHealthBonus += sd(b, self, 1, self.mult);
    },
    onSelfDeath: (b, self) => {
      const s = self.side;
      s.spellAttackBonus = Math.max(0, s.spellAttackBonus - sd(b, self, 1, self.mult));
      s.spellHealthBonus = Math.max(0, s.spellHealthBonus - sd(b, self, 1, self.mult));
    },
  });

  // Timewarped Deios (T5): Your Battlecries, Deathrattles, and Rallies trigger twice (golden: three
  // times). Implemented by the engine (`deathrattleMultiplier` / `rallyMultiplier`).
  registerMinion('BG34_Giant_376', {});

  // =========================================================================
  // Cards gained in combat: only the hand count matters (The Shadow of Doubt, Timewarped Peggy).
  // =========================================================================
  registerMinion('BG34_Giant_078', getsCards(1, 'deathrattle')); // Thorncaller: BC+DR: Get a Blood Gem Barrage
  registerMinion('BG34_Giant_204', getsCards(1, 'deathrattle')); // Pillager: DR: Get a Tavern Coin
  registerMinion('BG34_Giant_304', getsCards(1, 'deathrattle')); // Sapper: DR: Get a Spitescale Special
  registerMinion('BG34_Giant_325', getsCards(1, 'deathrattle')); // Riplash: DR: Get a copy of the last Tavern spell
  registerMinion('BG34_Giant_326', getsCards(1, 'deathrattle')); // Tony: DR: Get a copy of Eyes of the Earth Mother
  registerMinion('BG34_Giant_582', getsCards(1, 'deathrattle')); // Sporebat: DR: Get a random Tavern spell
  registerMinion('BG34_Giant_584', getsCards(1, 'deathrattle')); // Kil'rek: DR: Get a random Demon
  registerMinion('BG34_Giant_588', getsCards(1, 'deathrattle')); // Hunter: BC+DR: Get a Pointy Arrow
  registerMinion('BG34_Giant_670', getsCards(1, 'deathrattle')); // Rodeo Performer: gains "DR: Get another copy of it"
  registerMinion('BG34_Giant_585', getsCards(1, 'rally')); // Vaelastrasz: Rally: Get a random Dragon
  registerMinion('BG34_PreMadeChamp_091', getsCards(1, 'deathrattle', 'rally')); // Calligrapher: BC+DR+Rally: Get a Tavern spell
  registerMinion('BG34_Giant_211', avengeGetsCards(3, 2)); // Pashmar: Avenge (3): Get a Spellcraft spell and a Tavern spell
  registerMinion('BG34_Giant_302', avengeGetsCards(3, 1)); // Copter: Avenge (3): Get a random Mech
  registerMinion('BG34_Giant_598', avengeGetsCards(4, 1)); // Mothership: Avenge (4): Get a random Protoss minion
  registerMinion('BG34_Giant_605', avengeGetsCards(4, 1)); // Traveler: Avenge (4): Get a 1-Cost Minor Timewarp card
  registerMinion('BG34_PreMadeChamp_022', avengeGetsCards(2, 1)); // Prismscale: Avenge (2): Get an Azerite Empowerment
  // Timewarped Stormcloud: Deathrattle and Avenge (3): Get a Tavern Tempest (golden: 2).
  registerMinion('BG34_PreMadeChamp_031', { ...avengeGetsCards(3, 1), ...getsCards(1, 'deathrattle') });

  // =========================================================================
  // No combat effect beyond keywords / stats (verified from the card text)
  // =========================================================================
  registerMinion(
    [
      'BG34_Giant_001', // Busker - Battlecry and Deathrattle: Gain Gold next turn
      'BG34_Giant_002', // Relaxer - after you sell a Quilboar
      'BG34_Giant_006', // Molten Rock - after you play an Elemental
      'BG34_Giant_007', // Annoy-o-Tron - Taunt, Divine Shield, Reborn
      'BG34_Giant_008', // Seer - spell costs
      'BG34_Giant_009', // Alleycat - end of turn
      'BG34_Giant_012', // Cyclone - Divine Shield, Windfury, Reborn
      'BG34_Giant_021', // Sylvar - end of turn
      'BG34_Giant_032', // Nomi - after you play an Elemental (Tavern buff)
      'BG34_Giant_035', // Glowscale - Spellcraft
      'BG34_Giant_038', // Elise - Refreshes
      'BG34_Giant_039', // Winner - Stealth; start of turn reward
      'BG34_Giant_040', // Ichoron - whenever you play a minion
      'BG34_Giant_065', // Low-Flier - end of turn
      'BG34_Giant_067', // Sellemental - end of turn
      'BG34_Giant_072', // Skipper - after you sell
      'BG34_Giant_082', // Recycler - Avenge (4): maximum Gold
      'BG34_Giant_121', // Probius - Magnetic (shop)
      'BG34_Giant_206', // Murky - end of turn
      'BG34_Giant_209', // Sensei - end of turn
      'BG34_Giant_210', // Commander - Spellcraft
      'BG34_Giant_212', // Archer - Spellcraft
      'BG34_Giant_300', // Rewinder - hero damage in the Tavern
      'BG34_Giant_309', // Nine Frogs - after you buy
      'BG34_Giant_310', // Elegist - end of turn
      'BG34_Giant_311', // Shivarra - consumes happen in the Tavern
      'BG34_Giant_313', // Kil'jaeden - Refresh offers
      'BG34_Giant_314', // Poet - Dragons keep combat stats afterwards
      'BG34_Giant_318', // Murk-Eye - end of turn
      'BG34_Giant_319', // Painter - end of turn
      'BG34_Giant_320', // Mystic - after you sell Murlocs
      'BG34_Giant_322', // Pioneer - Refreshes
      'BG34_Giant_323', // Secretary - Spellcraft casts
      'BG34_Giant_324', // Summoner - Spellcraft
      'BG34_Giant_333', // Scout - when sold
      'BG34_Giant_335', // Theotar - after you play a minion
      'BG34_Giant_336', // Amalgam - after you play a minion
      'BG34_Giant_360', // Shadowdancer - Taunt; end of turn
      'BG34_Giant_361', // Upstart - after a Refresh
      'BG34_Giant_583', // Devourer - start of turn
      'BG34_Giant_586', // Snow Elemental - Refresh offers
      'BG34_Giant_589', // Sailor - Divine Shield; Refresh offers
      'BG34_Giant_591', // Acolyte - start of turn
      'BG34_Giant_594', // Botani - end of turn
      'BG34_Giant_596', // Archimonde - hero damage in the Tavern
      'BG34_Giant_602', // Lei - start of turn
      'BG34_Giant_603', // Tender - end of turn
      'BG34_Giant_604', // Tipper - end of turn
      'BG34_Giant_671', // Zerus - once per turn transform
      'BG34_Giant_676', // Trumpeter - after you sell Elementals
      'BG34_Giant_677', // Wargear - Magnetic (shop)
      'BG34_Giant_678', // Lava Lurker - Spellcraft from hand
      'BG34_Giant_681', // Shadequill - end of turn
      'BG34_Giant_683', // Lucky Egg - transforms in two turns
      'BG34_Giant_686', // Swirler - Elemental Tavern buffs
      'BG34_Giant_777', // Behemoth - Taunt; after you buy an Elemental
      'BG34_Giant_801', // Astrogill - only while in hand (hand copies are not tracked in combat)
      'BG34_PreMadeChamp_011', // Overfiend - after you buy a card
      'BG34_PreMadeChamp_013', // Imp-filtrator - after you spend Gold
      'BG34_PreMadeChamp_032', // Substrate - Divine Shield; end of turn
      'BG34_PreMadeChamp_038', // Steamer - end of turn
      'BG34_PreMadeChamp_047', // Paleofin - end of turn
      'BG34_PreMadeChamp_049', // Squallfin - after you play a Murloc
      'BG34_PreMadeChamp_058', // Siren - after you play a Naga
      'BG34_PreMadeChamp_065', // Raider - after you play a card
      'BG34_PreMadeChamp_067', // Plunderer - Deathrattle: maximum Gold
      'BG34_PreMadeChamp_076', // Bloodbinder - start of turn
      'BG34_PreMadeChamp_078', // Bandit - start of turn
      'BG34_PreMadeChamp_083', // Anub'arak - after you play an Undead
      'BG34_PreMadeChamp_090', // Clefthoof - end of turn
    ],
    { noCombatEffect: true },
  );
}
