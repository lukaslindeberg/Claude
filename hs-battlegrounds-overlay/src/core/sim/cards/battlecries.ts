/**
 * Battlecries triggered in combat (Timewarped Greenskeeper, Rylak Metalhead / Rylak Portrait,
 * Battle Horn) and the effects that change them (Brann Bronzebeard, Timewarped Deios, Dragon's Eye).
 *
 * Only battlecries with an effect on the combat get a `battlecry` hook here; the others only
 * change the shop (Tavern buffs, Gold, Discover...) and do nothing when triggered in combat,
 * except "Get a card" battlecries, which count as cards added to hand (The Shadow of Doubt).
 * A battlecry that targets ("Give a Pirate ...", "Destroy a friendly Undead") picks a random
 * valid target, like the game does when a battlecry is triggered by another effect.
 *
 * `registerBattlecries()` runs after the tribe files: it adds the hook to an existing handler of
 * the card, or registers `{ noCombatEffect, battlecry }` for cards that had none.
 */
import { registerEffect, registeredMinionHandler, registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  destroy,
  giveDeity,
  giveDivineShield,
  giveReborn,
  giveTaunt,
  giveTeamDeities,
  giveVenomous,
  giveWindfury,
  hasDeathrattle,
  hasTribe,
  improveBeetles,
  improveUndeadAttack,
  isAlive,
  neighbours,
  randomFriendlies,
  randomFriendly,
  rightMost,
  rightOfAnchor,
  sd,
  summonBeetles,
  triggerDeathrattlesArtificially,
} from './helpers';
import { cardsAddedToHand } from './aberration';
import { makeGolden } from './neutral';
import { isDeios } from '../engine/deaths';
import type { Battle, CardHandler, Minion } from '../engine/types';

const DRAGONS_EYE = 'BG36_MagicItem_215';
const BRANN = 'BG_LOE_077';
const BRANN_G = 'TB_BaconUps_045';

/** Whether a minion has a Battlecry (card mechanic or a registered hook). */
export function hasBattlecry(b: Battle, m: Minion): boolean {
  return !!m.handler?.battlecry || !!b.db.get(m.cardId)?.mechanics.includes('BATTLECRY');
}

/**
 * How many times a Battlecry of `m` triggers: Brann (twice, golden three times) or Timewarped Deios
 * (twice / three times) - the highest applies -, plus one per Dragon's Eye for Dragons.
 */
export function battlecryTriggers(m: Minion): number {
  const side = m.side;
  let n = 1;
  for (const o of side.board) {
    if (!isAlive(o)) continue;
    if (o.cardId === BRANN || o.cardId === BRANN_G || isDeios(o)) n = Math.max(n, o.golden ? 3 : 2);
  }
  if (hasTribe(m, 'DRAGON')) for (const e of side.effects) if (e.cardId === DRAGONS_EYE) n++;
  return n;
}

/** Trigger `m`'s Battlecry `times` times (x Brann / Deios / Dragon's Eye). */
export function triggerBattlecry(b: Battle, m: Minion, times = 1): void {
  const fn = m.handler?.battlecry;
  if (!fn) return;
  const n = times * battlecryTriggers(m);
  for (let i = 0; i < n; i++) fn(b, m);
}

const others = (self: Minion) => (m: Minion) => m !== self;
const undeadOther = (self: Minion) => (m: Minion) => m !== self && hasTribe(m, 'UNDEAD');

/** "Make a friendly minion from Tier N or below Golden" (random non-golden target). */
function makeGoldenFriendlies(b: Battle, self: Minion, count: number, maxTier: number, tribe?: 'PIRATE'): void {
  const ok = (m: Minion) =>
    !m.golden && m.tier <= maxTier && !!b.db.goldenOf(m.cardId) && (!tribe || hasTribe(m, tribe));
  for (const t of randomFriendlies(b, self.side, count, ok)) makeGolden(b, t);
}

const BONUS_KEYWORDS: { has: (m: Minion) => boolean; give: (b: Battle, m: Minion) => void }[] = [
  { has: (m) => m.taunt, give: (_b, m) => giveTaunt(m) },
  { has: (m) => m.divineShield, give: (b, m) => giveDivineShield(b, m) },
  { has: (m) => m.windfury || m.megaWindfury, give: (_b, m) => giveWindfury(m) },
  { has: (m) => m.venomous, give: (_b, m) => giveVenomous(m) },
  { has: (m) => m.reborn, give: (_b, m) => giveReborn(m) },
  { has: (m) => m.stealth, give: (_b, m) => void (m.stealth = true) },
];

/** Combat-relevant battlecries (keyed by the normal id; golden versions read `self.mult` / script data). */
const BATTLECRIES: Record<string, (b: Battle, self: Minion) => void> = {
  // Sanguine Champion: Your Blood Gems give an extra +2/+1 this game.
  BG23_017: (b, self) => {
    self.side.bloodGemAttack += sd(b, self, 1, 2 * self.mult);
    self.side.bloodGemHealth += sd(b, self, 2, self.mult);
  },
  // Nerubian Deathswarmer: Your Undead have +1 Attack this game.
  BG25_011: (b, self) => improveUndeadAttack(b, self.side, self.mult),
  // Captain Sanders: Make a friendly minion from Tier 6 or below Golden (golden: two).
  BG25_034: (b, self) => makeGoldenFriendlies(b, self, self.mult, 6),
  // Lovesick Balladist: Give a Pirate +X/+2 (X = Gold spent this turn, script data 1; golden: twice).
  BG26_814: (b, self) => {
    for (let i = 0; i < self.mult; i++) {
      const t = randomFriendly(b, self.side, (m) => hasTribe(m, 'PIRATE'));
      if (t) buff(b, t, sd(b, self, 1, 0), sd(b, self, 2, 2));
    }
  },
  // Electric Synthesizer: Give your other Dragons +1/+1.
  BG26_963: (b, self) => {
    for (const m of aliveMinions(self.side)) if (m !== self && hasTribe(m, 'DRAGON')) buff(b, m, self.mult, self.mult);
  },
  // Disguised Graverobber: Destroy a friendly Undead to get a plain copy of it.
  BG28_303: (b, self) => {
    const t = randomFriendly(b, self.side, undeadOther(self));
    if (!t) return;
    destroy(b, t, self);
    cardsAddedToHand(b, self.side, self.mult);
  },
  // Hackerfin: Give your other minions +3/+2 (improved; current values in script data 1/2).
  BG31_148: (b, self) => {
    const a = sd(b, self, 1, 3 * self.mult);
    const h = sd(b, self, 2, 2 * self.mult);
    for (const m of aliveMinions(self.side)) if (m !== self) buff(b, m, a, h);
  },
  // Bubble Gunner: Gain a random Bonus Keyword (golden: 2).
  BG31_149: (b, self) => {
    for (let i = 0; i < self.mult; i++) {
      const k = b.rng.pick(BONUS_KEYWORDS.filter((x) => !x.has(self)));
      k?.give(b, self);
    }
  },
  // Forest Rover: Your Beetles have +X/+X this game.
  BG31_801: (b, self) => improveBeetles(b, self.side, sd(b, self, 3, 2 * self.mult), sd(b, self, 4, self.mult)),
  // Elite Navigator: Make a friendly Pirate from Tier 4 or below Golden (golden: 2).
  BG32_231: (b, self) => makeGoldenFriendlies(b, self, self.mult, 4, 'PIRATE'),
  // Maw Caster: Destroy a friendly Undead to Discover an Undead (golden: 2).
  BG32_340: (b, self) => {
    const t = randomFriendly(b, self.side, undeadOther(self));
    if (!t) return;
    destroy(b, t, self);
    cardsAddedToHand(b, self.side, self.mult);
  },
  // Azsharan Cutlassier: Your Tavern spells give an extra +1 Attack this game.
  BG33_830: (_b, self) => void (self.side.spellAttackBonus += self.mult),
  // Timewarped Nest Swarmer: Your Beetles have +X/+X this game. Summon a 2/2 Beetle.
  BG34_Giant_687: (b, self) => {
    improveBeetles(b, self.side, sd(b, self, 3, 2 * self.mult), sd(b, self, 4, 2 * self.mult));
    summonBeetles(b, self.side, self.mult, rightOfAnchor(self));
  },
  // Joyous: Give your Deity +2/+1.
  BG36_110: (b, self) => giveDeity(b, self.side, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, self.mult)),
  // Orc-estra Conductor: Give a minion +2/+2 (improved; script data 1/2).
  BGDUO_119: (b, self) => {
    const t = randomFriendly(b, self.side, others(self)) ?? self;
    buff(b, t, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 2 * self.mult));
  },
  // C'Thrax Wrecker: Give your team's Deities +4/+4.
  BGDUO_701: (b, self) => giveTeamDeities(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 4 * self.mult)),
};

/** "Battlecry: Get N cards" (normal count; golden doubles): only counted as cards added to hand. */
const GET_CARDS: Record<string, number> = {
  BG20_100: 2, // Razorfen Geomancer: 2 Blood Gems
  BG23_002: 1, // Shell Collector: Tavern Coin
  BG27_000: 2, // Iron Groundskeeper: 2 Fortify
  BG28_550: 1, // Rodeo Performer: Discover a Tavern spell
  BG32_111: 1, // Nightmare Par-tea Guest
  BG32_336: 1, // Gormling Gourmet
  BG32_820: 1, // Firescale Hoarder
  BG33_821: 1, // Shipwrecked Rascal
  BG34_170: 1, // Auto Accelerator
  BG34_319: 1, // Highkeeper Ra
  BG34_633: 1, // Draconic Warden
  BG34_682: 1, // Razorfen Flapper
  BG34_Giant_078: 1, // Timewarped Thorncaller
  BG34_Giant_588: 1, // Timewarped Hunter
  BG34_PreMadeChamp_091: 1, // Timewarped Calligrapher
  BG35_881: 1, // Leyline Surfacer
  BG35_882: 1, // Firelands Fugitive
  BG36_103: 1, // N'raqi Sapper
  BG36_112: 1, // Fetid Corroder
  BG36_343: 1, // Silent Deliverer
  BG36_520: 1, // Bilgewater Breakout
  BGS_020: 1, // Primalfin Lookout
  BGS_123: 1, // Tavern Tempest
  TB_BaconShop_HERO_18_Buddy: 1, // Tuskarr Raider: a random Bounty
};

function attach(id: string, fn: (b: Battle, self: Minion) => void): void {
  const existing = registeredMinionHandler(id);
  // Copied, not mutated: "no combat effect" handler objects are shared by many cards.
  registerMinion(id, existing ? { ...existing, battlecry: fn } : { noCombatEffect: true, battlecry: fn });
}

const RYLAK = 'BG26_801';

/** Rylak Metalhead: Deathrattle: Trigger the Battlecry of an adjacent minion (golden: adjacent minions). */
const RYLAK_HANDLER: CardHandler = {
  deathrattle: (b, self, ctx) => {
    let adj: Minion[];
    if (ctx.artificial && isAlive(self)) adj = neighbours(self);
    else {
      const board = ctx.anchor.side.board;
      const i = ctx.anchor.slot;
      adj = [board[i - 1], board[i]].filter((m): m is Minion => !!m && isAlive(m));
    }
    adj = adj.filter((m) => hasBattlecry(b, m));
    const one = b.rng.pick(adj);
    const targets = ctx.golden ? adj : one ? [one] : [];
    for (const t of targets) triggerBattlecry(b, t);
  },
};

export function registerBattlecries(): void {
  for (const [id, fn] of Object.entries(BATTLECRIES)) attach(id, fn);
  for (const [id, n] of Object.entries(GET_CARDS)) attach(id, (b, self) => void cardsAddedToHand(b, self.side, n * self.mult));

  registerMinion(RYLAK, RYLAK_HANDLER);

  // Timewarped Greenskeeper: Rally: Trigger your right-most Battlecry and Deathrattle (golden: twice).
  registerMinion('BG34_Giant_041', {
    rally: (b, self) => {
      for (let i = 0; i < self.mult; i++) {
        const bc = rightMost(self.side, (m) => hasBattlecry(b, m));
        if (bc) triggerBattlecry(b, bc);
        const dr = rightMost(self.side, hasDeathrattle);
        if (dr) triggerDeathrattlesArtificially(b, dr);
      }
    },
  });

  // Rylak Portrait: Start of Combat: Trigger your Rylak Metalheads' Deathrattles.
  registerEffect('BG35_MagicItem_834', {
    startOfCombat: (b, e) => {
      for (const m of aliveMinions(e.side)) {
        if (m.cardId === RYLAK || m.cardId === `${RYLAK}_G`) triggerDeathrattlesArtificially(b, m);
      }
    },
  });
  // Battle Horn: Avenge (2): Trigger a friendly Battlecry.
  registerEffect('BG32_MagicItem_415', {
    avenge: 2,
    onAvenge: (b, e) => {
      const t = randomFriendly(b, e.side, (m) => hasBattlecry(b, m));
      if (t) triggerBattlecry(b, t);
    },
  });
  // Dragon's Eye: Your Dragons' Battlecries trigger an extra time (read by `battlecryTriggers`).
  registerEffect(DRAGONS_EYE, {});
}

/** Pool / Timewarped minions with a Battlecry that does something in combat (for tests and docs). */
export function combatBattlecryIds(): string[] {
  return Object.keys(BATTLECRIES);
}

