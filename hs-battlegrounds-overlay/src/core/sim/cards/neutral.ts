/** Neutral (no tribe) and all-type minion handlers. */
import { LOBBY_TRIBES, type MinionSnapshot } from '@shared/types';
import { getMinionHandler, registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  castSpell,
  dealDamage,
  destroy,
  giveDivineShield,
  hasTribe,
  isAlive,
  minionFromSnapshot,
  randomFriendly,
  randomFriendlies,
  sd,
  setCounter,
  SHIELD_HITS,
  summonForDeath,
} from './helpers';
import { recalcAuras } from '../engine/auras';
import { getsCards } from './aberration';
import type { Battle, CardHandler, Minion } from '../engine/types';

/**
 * Make a minion Golden in combat: golden card id (same handler, `mult` 2), the card's base stats
 * are added again, and script data switches to the golden card's values unless the snapshot holds
 * an improved value.
 */
export function makeGolden(b: Battle, m: Minion): void {
  if (m.golden || !isAlive(m)) return;
  const gid = b.db.goldenOf(m.cardId);
  if (!gid) return;
  const card = b.db.get(m.cardId);
  const g = b.db.get(gid);
  m.attack += card?.attack ?? 0;
  m.health += card?.health ?? 0;
  m.maxHealth += card?.health ?? 0;
  if (g?.tags) {
    const t = { ...m.tags };
    for (const [k, v] of Object.entries(g.tags)) {
      if (k.startsWith('TAG_SCRIPT_DATA_NUM_') && (t[k] === undefined || t[k] === card?.tags?.[k])) t[k] = v;
    }
    m.tags = t;
  }
  m.cardId = gid;
  m.golden = true;
  m.mult = 2;
  m.handler = getMinionHandler(gid, b.db);
}

/**
 * Transform a living minion into a copy of `snap` (same board slot; not a death). Returns the new
 * minion, or null when `m` is not on the board.
 */
export function transformInto(b: Battle, m: Minion, snap: MinionSnapshot, golden = false): Minion | null {
  const side = m.side;
  const i = side.board.indexOf(m);
  if (i < 0 || !isAlive(m)) return null;
  const n = minionFromSnapshot(b, side, { ...snap, entityId: b.nextEntityId++ });
  if (golden) makeGolden(b, n);
  side.board[i] = n;
  m.removed = true;
  if (side.lastAttacker === m) side.lastAttacker = n;
  if (n.handler?.aura) b.hasAuras = true;
  if (b.hasAuras) recalcAuras(b);
  return n;
}

/** Teammate (Duos) minion with the highest `key` (ties random), from the waiting teammate board. */
export function teammateHighest(b: Battle, side: Minion['side'], key: (s: MinionSnapshot) => number): MinionSnapshot | undefined {
  const list = side.teammate?.minions ?? [];
  let best: MinionSnapshot[] = [];
  let v = -Infinity;
  for (const s of list) {
    const x = key(s);
    if (x > v) {
      v = x;
      best = [s];
    } else if (x === v) best.push(s);
  }
  return b.rng.pick(best);
}

/** "Divine Shield takes N hits to break": SD1 = N; re-armed whenever the minion gains a shield. */
const multiHitShield = (fallback: number): CardHandler => {
  const arm = (b: Battle, m: Minion) => setCounter(m, SHIELD_HITS, Math.max(0, sd(b, m, 1, fallback) - 1));
  return {
    init: (b, self) => {
      if (self.divineShield) arm(b, self);
    },
    onDivineShieldChanged: (b, self, has) => {
      if (has) arm(b, self);
    },
  };
};

export function registerNeutrals(): void {
  // Boom-in-a-Box (T4): Taunt. Start of Combat: Deal 3 damage to all other minions (golden: twice).
  registerMinion('BG36_620', {
    startOfCombat: (b, self) => {
      const dmg = sd(b, self, 1, 3);
      for (let i = 0; i < self.mult; i++) {
        const victims = [...aliveMinions(self.side), ...aliveMinions(self.side.opponent)].filter((m) => m !== self);
        for (const v of victims) dealDamage(b, self, v, dmg);
      }
    },
  });

  // Heroic Underdog (T4): Stealth. Rally: Gain the target's Attack (golden: double).
  registerMinion('BG34_604', {
    rally: (b, self, target) => buff(b, self, target.attack * self.mult, 0),
  });

  // Sin'dorei Straight Shot (T4): Divine Shield, Windfury. Rally: Remove Reborn and Taunt from the target.
  registerMinion('BG25_016', {
    rally: (_b, _self, target) => {
      target.reborn = false;
      target.taunt = false;
    },
  });

  // Leeroy the Reckless (T5): Deathrattle: Destroy the minion that killed this.
  registerMinion('BG23_318', {
    deathrattle: (b, self, ctx) => {
      const k = ctx.killer;
      if (k && k.side !== self.side && isAlive(k)) destroy(b, k, self);
    },
  });

  // Selfless Hero: Deathrattle: Give a random friendly minion Divine Shield (golden: 2).
  registerMinion('BG_OG_221', {
    deathrattle: (b, self, ctx) => {
      for (const t of randomFriendlies(b, self.side, ctx.mult, (m) => !m.divineShield, self)) giveDivineShield(b, t);
    },
  });

  // The Last One Standing (T7): Rally: Give a friendly minion of each type +10/+10 (golden: twice).
  // ("improve this" is not simulated.)
  registerMinion('BG34_320', {
    rally: (b, self) => {
      const a = sd(b, self, 1, 10);
      const h = sd(b, self, 2, 10);
      for (let r = 0; r < self.mult; r++) {
        const used = new Set<Minion>();
        for (const tribe of LOBBY_TRIBES) {
          const t = randomFriendly(b, self.side, (m) => !used.has(m) && m.tribes.length > 0 && hasTribe(m, tribe));
          if (!t) continue;
          used.add(t);
          buff(b, t, a, h);
        }
      }
    },
  });

  // Dark Paradox (T1, all types): a random Dark Gift per game; the board carries the variant id.
  registerMinion('BG36_360t4', multiHitShield(3)); // Divine Shield takes 3 hits to break (golden: 4)
  registerMinion('BG36_360t5', getsCards(1, 'rally')); // Rally: Get a random minion (golden: 2)
  // Deathrattle: Summon a Golem with this minion's stats (golden: double).
  registerMinion('BG36_360t9', {
    deathrattle: (b, self, ctx) => {
      const k = ctx.mult;
      summonForDeath(b, self, ctx, 'BG36_333t', 1, {
        name: 'Golem',
        attack: self.attack * k,
        health: self.maxHealth * k,
        tribes: [],
        tier: 1,
      });
    },
  });

  // Gatekeeper Amalgam (T6): Whenever you cast a spell on this, it casts Misplaced Tea Set (golden: twice).
  registerMinion('BG36_640', {
    onSpellCast: (b, self, _spell, target) => {
      if (target !== self) return;
      for (let i = 0; i < self.mult; i++) castSpell(b, self.side, 'BG28_888');
    },
  });

  // Sandy (T7, Duos): Start of Combat: Transform into a copy of your teammate's highest-Health
  // minion (golden: a Golden copy). Needs the teammate board in the input.
  registerMinion('BGDUO_125', {
    startOfCombat: (b, self) => {
      const t = teammateHighest(b, self.side, (s) => s.health);
      if (t) transformInto(b, self, t, self.golden);
    },
  });

  // Cards gained in combat (only the hand count matters, for The Shadow of Doubt; golden: 2).
  registerMinion('BG32_111', getsCards(1, 'deathrattle')); // Nightmare Par-tea Guest
  registerMinion('BG34_319', getsCards(1, 'deathrattle', 'rally')); // Highkeeper Ra

  // Titus Rivendare and Balinda Stonehearth are handled by the engine (deathrattle multiplier,
  // targeted spell casts).
  registerMinion(['BG25_354', 'BG35_883'], { noCombatEffect: true });

  registerMinion(
    [
      'BGDUO_114', // Passenger
      'BG36_345', // Suspicious Prisonguard
      'BG36_354', // Decoy Conjurer
      'BGDUO_104', // Friendly Saloonkeeper
      'BG32_237', // Intrepid Botanist
      'BG24_715', // Patient Scout
      'BGDUO_100', // Wanderer Cho
      'BGS_131', // Deadly Spore (Venomous)
      'BG36_346', // Fruit Vendor
      'BG27_000', // Iron Groundskeeper
      'BGDUO_115', // Jumping Jack
      'BGDUO_119', // Orc-estra Conductor
      'BG28_303', // Disguised Graverobber
      'BG36_372', // Holy Vanguard (stats in snapshot)
      'BG32_341', // Humon'gozz
      'BG24_018', // Tortollan Blue Shell
      'BG_LOE_077', // Brann Bronzebeard
      'BG35_123', // Cataclysmic Harbinger
      'BG26_ICC_901', // Drakkari Enchanter
      'BG28_550', // Rodeo Performer
      'BG36_356', // Tyrael
      'BGDUO_108', // Mirror Monster
      'BGDUO_120', // Well Wisher
      'BGDUO31_212', // Mantid King (triggers on Pass: shop)
      'TB_BaconShop_HP_033t', // Amalgam (Venomous)
      'BG28_Reward_518t', // Totally Normal Horse
      'BG36_360', // Dark Paradox (placeholder; in play it is one of the variants)
      'BG36_360t3', // Dark Paradox: Whenever you play a card...
      'BG36_360t6', // Dark Paradox: Has +4/+4 per Battlecry (stats in snapshot)
    ],
    { noCombatEffect: true },
  );
}
