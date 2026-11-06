# Battlegrounds combat simulator (`src/core/sim`)

Original Monte Carlo simulator for Hearthstone Battlegrounds combat (patch 37.0.2 card data).
No third-party simulator code is used.

```ts
import { simulateBattle } from '@core/sim';

const result = simulateBattle(input, { iterations: 4000, maxDurationMs: 1500, seed: 1 });
// { win, tie, loss, avgDamageDealt, avgDamageTaken, lethalWin, lethalLoss,
//   iterations, durationMs, unsupported, damageDistribution }
```

- `simulateBattle(input, options?, cardDb?)` is pure and synchronous, deterministic for a given
  `options.seed`, stops at `iterations` (default 4000) or `maxDurationMs` (default 1500), and never
  throws: an iteration that crashes counts as a tie.
- `unsupported` lists card ids in the input (minions, hero powers, trinkets, quest rewards,
  anomaly) that have combat-relevant mechanics/text but no handler. Unknown cards fight as vanilla
  minions.
- `damageDistribution`: key = signed damage (`"7"` = we deal 7, `"-4"` = we take 4, `"0"` = tie),
  value = probability.
- Worker: `src/core/sim/worker.ts` takes `{ id, input, options? }` and answers `{ id, result }` or
  `{ id, error }` (types `SimWorkerRequest` / `SimWorkerResponse`):

  ```ts
  const worker = new Worker(new URL('../../core/sim/worker.ts', import.meta.url), { type: 'module' });
  ```

## Layout

```
sim/
  index.ts            public API
  simulate.ts         Monte Carlo driver + unsupported-card detection
  worker.ts           Web Worker entry
  engine/
    types.ts          Minion, SideState, Battle, CardHandler, EffectHandler, ...
    rng.ts            mulberry32 seeded RNG
    battle.ts         build a Battle from BattleSimInput, attack loop, outcome & damage
    startOfCombat.ts  Start of Combat phase ordering
    attack.ts         attacker/target selection, the attack sequence, "attacks immediately"
    actions.ts        primitives: buff, dealDamage, destroy, summon, Blood Gems, spells, Deity
    deaths.ts         death phase: Avenge, Deathrattles (Titus...), Reborn, "when you have space"
    board.ts          insert/remove bookkeeping (attack pointer, dead-minion slots)
    events.ts         event bus (dispatch to minion handlers and side-level effects)
    auras.ts          static aura recalculation
    minion.ts         minions from snapshots / card ids, copies, Reborn copies
    constants.ts      tag names read from the input, safety limits
  cards/
    registry.ts       registerMinion / registerEffect / registerEnchantment
    helpers.ts        building blocks for handlers (re-exports the engine actions)
    neutral.ts beast.ts demon.ts dragon.ts elemental.ts mech.ts murloc.ts naga.ts
    pirate.ts quilboar.ts undead.ts aberration.ts
    heroPowers.ts trinkets.ts questRewards.ts anomalies.ts
    index.ts          ensureCardsRegistered(): registers everything (add new files here)
```

## Combat model

1. **Setup** (`battle.ts`): minions are built from the snapshots (stats already include buffs and
   auras), sorted by `position`. Hero power, trinkets, quest rewards and the anomaly (added to
   both sides) become side-level `EffectInstance`s. The side with more minions attacks first
   (random if equal), decided before Start of Combat.
2. **Start of Combat** (`startOfCombat.ts`): hero powers, quest rewards, trinkets, anomaly (first
   attacker's side first at each step), then hand effects (Flighty Scout), then minion effects
   alternating between the sides starting with the first attacker's left-most minion. Deaths are
   resolved after each effect.
3. **Attacks** (`attack.ts`): sides alternate. Each side has a pointer to its next attacker: after
   a minion attacks the pointer moves right of it and wraps around at the end. Removing a minion
   left of the pointer shifts it left, inserting left of it shifts it right, and minions
   summoned into the slot of the minion the pointer refers to (for example the Deathrattle tokens
   of an attacker that died) attack next. 0-Attack minions are skipped. Windfury attacks 2 times,
   Mega-Windfury 4.
   - Target: random Taunt minion, else random non-Stealth minion, else any.
   - Rally ("whenever this attacks") and "whenever a friendly minion attacks" triggers, then a
     death phase. If the attacker or the target died, the attack fizzles.
   - Simultaneous damage: attacker to target (+ Cleave on its neighbours), target to attacker.
     Divine Shield absorbs a hit (0 damage never pops it). Venomous/Poisonous destroy a minion they
     damage; Venomous is then lost (not lost when the hit was absorbed by Divine Shield).
   - Kill/overkill (`onKill`) and "after attack" triggers, then a death phase.
4. **Death phase** (`deaths.ts`), repeated until stable: remove dead minions (the active side
   first, left to right, remembering their slots); per death, bookkeeping, Avenge counters and
   "when a friendly minion dies" triggers; fire completed Avenges; Deathrattles in the same order
   (own + granted by enchantments, repeated for Titus / Turbulent Tombs / Echoes of Argus); Reborn
   (base card, 1 Health, right of its deathrattle summons); "when you have space" summons. Summons
   are capped at 7 minions.
5. **End**: a side has no minions left. Damage = winner's tavern tier + tiers of surviving minions
   (tokens without tier count 1), capped by `input.damageCap`. Tie when both boards are empty,
   neither side can attack, or after 400 attacks (loop guard). Lethal = damage ≥ health + armor.
6. **Duos**: when a side's board is exhausted its `teammate` board joins (no Start of Combat).

## Writing a card handler

Handlers live in the tribe file of the card and are keyed by the **normal** card id; golden ids
resolve to the same handler (`self.golden`, `self.mult` = 1 or 2). Prefer reading numbers with
`sd(b, self, n, fallback)`: it returns the minion's `TAG_SCRIPT_DATA_NUM_n` from the snapshot (it
reflects in-game improvements), else the card's own value (golden cards carry doubled values), else
the fallback. Mark shop-only cards with `{ noCombatEffect: true }` so they are not reported as
unsupported.

```ts
// cards/beast.ts - a deathrattle that summons into the dead minion's slot
registerMinion('BG28_300', {
  deathrattle: (b, self, ctx) => {
    summonForDeath(b, self, ctx, 'BG_ICC_026t', 2 * ctx.mult); // golden: four Skeletons
  },
});

// a Rally (whenever this attacks) buffing other minions, values from script data
registerMinion('BG36_207', {
  rally: (b, self) => buffAll(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, self.mult), undefined, self),
});

// Avenge + a trigger reacting to keyword changes
registerMinion('BG34_405', {
  init: (_b, self) => void (self.taunt = self.divineShield),
  onDivineShieldChanged: (_b, self, has) => void (self.taunt = has),
  avenge: 3,
  onAvenge: (b, self) => giveDivineShield(b, self),
});

// side-level effect (hero power / trinket / quest reward / anomaly)
registerEffect('BG30_MagicItem_970', { startOfCombat: (b, e) => buffAll(b, e.side, 2, 2) });

// deathrattle granted by an enchantment found in MinionSnapshot.enchantments
registerEnchantment('BG22_HERO_001p_t1e', { deathrattle: EARTH_DR });
```

### `CardHandler` hooks (minions; all optional)

| Hook | When |
|---|---|
| `init(b, self)` | minion created (snapshot, summon, Reborn). Set static flags (e.g. `cleave`). |
| `onSummoned(b, self)` | after this minion was summoned in combat |
| `startOfCombat(b, self)` | Start of Combat (repeated by Wind Chimes / Promo Portrait) |
| `handStartOfCombat(b, card, side)` | Start of Combat while in hand |
| `deathrattle(b, self, ctx)` | `ctx.anchor` (summon slot), `ctx.killer`, `ctx.golden`, `ctx.mult`, `ctx.artificial` |
| `avenge` + `onAvenge(b, self)` | after N friendly deaths while alive; counter resets |
| `rally(b, self, target)` | whenever this attacks, before damage |
| `onFriendlyAttack(b, self, attacker, target)` | any friendly attack incl. self (check `attacker !== self` for "another") |
| `afterAttack(b, self, info)` | after this attacked and survived (`info.killed`, `info.excess`, `info.targetIndex`) |
| `afterFriendlyAttack(b, self, info)` | after any friendly attack |
| `onDamaged(b, self, amount, source)` | whenever this takes damage (also fatal) |
| `onFriendlyDealtDamage(b, self, dealer, target, amount)` | another friendly minion dealt damage |
| `onDivineShieldChanged(b, self, has)` / `onFriendlyDivineShieldLost(b, self, lost)` | shield changes |
| `onFriendlyDeath(b, self, dead)` / `onEnemyDeath(b, self, dead)` / `onSelfDeath(b, self)` | deaths |
| `onFriendlySummon` / `afterFriendlySummon(b, self, summoned)` | "whenever" / "after" you summon (not self) |
| `onFriendlyReborn(b, self, reborn)` | after a friendly minion was Reborn |
| `onKill(b, self, victim, excess)` | this killed a minion with attack damage (overkill = `excess`) |
| `onDeathrattleTriggered(b, self, source)` | after a friendly Deathrattle triggered |
| `onBloodGem(b, self)` | after a Blood Gem was played on this |
| `onStatsChanged(b, self)` | after `buff` / `setStats` |
| `onSpellCast(b, self, spellId, target)` | owner cast a Tavern spell in combat (`target === self`: "on this") |
| `aura(b, self, target)` | static aura bonus `{attack, health}` for `target`, recomputed on board changes |

`EffectHandler` (side-level) has `init`, `startOfCombat`, `avenge`/`onAvenge`, `onFriendlyDeath`,
`onFriendlyAttack`, `afterFriendlyAttack`, `onFriendlySummon`, `afterFriendlySummon`,
`onFriendlyReborn`, `onDeathrattleTriggered`, `onBoardEmpty`, `onDeityAwakened`, `onEnemyDeath`,
`onFriendlyDamaged`, `onFriendlyDivineShieldLost`, `onSpellCast`; `e.side`,
`e.scriptData1/2` (trinket / hero power script data), `e.data` scratch.

Useful helpers (`cards/helpers.ts`): `summonForDeath`, `summonRightOf`, `summonTokens`, `summon`,
`buff`, `buffAll`, `dealDamage`, `destroy`, `giveDivineShield`, `giveReborn`, `giveTaunt`,
`giveVenomous`, `playBloodGem`, `castSpell`, `giveDeity`, `attackImmediately`,
`triggerDeathrattlesArtificially`, `queueSpaceSummon`, `randomFriendly(ies)`, `randomPoolMinion`,
`highestBy`, `leftMost`, `rightMost`, `neighbours`, `highestInHand`, `summonFromHand`,
`summonBeetles`, `improveBeetles`, `improveUndeadAttack`, `counter`/`setCounter` (per-combat
counters), `sd`. Debug: set `battle.log = []` before `runBattle` to get an attack/death/summon log.

### Player tags read from `SimSide.playerTags` (or `heroTags`)

| Key | Meaning (default) |
|---|---|
| `BACON_BLOODGEMBUFFATKVALUE` / `BACON_BLOODGEMBUFFHEALTHVALUE` | extra Blood Gem stats (a gem gives 1 + value) |
| `BACON_GLOBAL_OLD_GOD_DBID`, `BACON_OLD_GOD_ATTACK`, `BACON_OLD_GOD_HEALTH` | the Deity and its stats |
| `SIM_UNDEAD_ATTACK_BONUS` | "your Undead have +X Attack this game" (0) - applied to Undead summoned in combat |
| `SIM_BEETLE_ATTACK` / `SIM_BEETLE_HEALTH` | Beetle stats (else from Beetle cards' script data, else 2/2) |
| `SIM_ETERNAL_KNIGHTS_DEAD` | Eternal Knights that died this game (0) |
| `SIM_TAVERN_SPELL_ATTACK_BONUS` / `SIM_TAVERN_SPELL_HEALTH_BONUS` | extra stats of Tavern spells cast in combat (0) |
| `SIM_ELEMENTALS_PLAYED`, `SIM_AUTOMATONS_SUMMONED` | Flourishing Frostling / Ancestral Automaton tokens (0) |

`SIM_*` keys have no single game tag (they come from player enchantments); the tracker may fill
them in when it can, otherwise the defaults apply.

## Coverage (patch 37.0.2, 302 pool minions)

"Combat handler" = effect implemented; "no combat effect" = explicitly verified to only matter in
the shop (battlecries, sell effects, "get a card" rallies/deathrattles, Tavern buffs) - their
keywords and snapshot stats are still simulated. Counted by first tribe.

| Tribe | Combat handler | No combat effect | Keyword-only | Unsupported |
|---|---:|---:|---:|---|
| Beast | 17 | 5 | 0 | - |
| Undead | 19 | 5 | 0 | - |
| Dragon | 11 | 11 | 1 | - |
| Quilboar | 12 | 15 | 0 | - |
| Aberration | 11 | 16 | 0 | - |
| Murloc | 9 | 15 | 0 | - |
| Mech | 8 | 17 | 0 | - |
| Naga | 5 | 18 | 0 | - |
| Neutral | 7 | 24 | 0 | - |
| Pirate | 6 | 19 | 0 | - |
| Elemental | 2 | 20 | 1 | - |
| Demon | 1 | 21 | 0 | - |
| All-type | 3 | 3 | 0 | - |
| **Total** | **111** | **189** | **2** | **0** |

Also implemented: 22 non-pool minions that appear through tokens/portraits/Ghastcoiler-style
effects (Sewer Rat, Kaboom Bot, Scallywag, Fish of N'Zoth, Selfless Hero, Harvest Golem, Cave Hydra,
Foe Reaper, Imp Gang Boss, Nest Swarmer, Runed Progenitor, Silky Shimmermoth, Impulsive Trickster,
Prized Promo-Drake, Bassgill, Stomping Stegodon, Fishbait, Ancestral Automaton, Flourishing
Frostling, Timewarped Nest Swarmer, C'Thun and Y'Shaarj Deities); 25 hero powers, 82 trinket ids (incl. greater versions), 9
quest rewards, 4 anomalies. Dark Paradox is handled per Dark Gift variant (`BG36_360t*`).

## Known simplifications

- Magnetization in combat (Glambot's Satellites) triggers Mechagnome Interpreter and Polarizing
  Beatboxer; Enchanted Sentinel's spell bonus is assumed to be part of the player's
  `TAVERN_SPELL_*_INCREASE` tags and is removed when it dies (magnetized Sentinels are not tracked).
- Hand buffs in combat (Murcules, Winterfinner, Tidehunter, Tidecaller) carry over to minions summoned
  from hand later in the same combat (Diremuck Forager, Bassgill).
- "Improve this permanently" parts are not simulated within a combat (Lurking Leviathan, The Last
  One Standing, Tasty Lobster's future lobsters); current values come from snapshot script data.
- Start of Combat minion order alternates between sides; hero powers/trinkets before minions.
- Reborn minions return as the base card (1 Health) plus "this game" bonuses; summoned "copies"
  keep current stats and granted deathrattles.
- Deity: awakens after 4 friendly Aberration deaths (from `BG_OldGod` data) at the right end of the
  board when there is space; C'Thun splits stats evenly (remainder random).
- Cards added to hand in combat are only counted (for The Shadow of Doubt, 10-card limit) by the
  "get a card" effects of the Naga/Pirate/Quilboar/Undead/Aberration/neutral files and a few side
  effects (`cardsAddedToHand` in `cards/aberration.ts`); other files' "get" effects do not count.
- Duos: the teammate board joins without Start of Combat; Sandy, Glorious Gloop and Summoning Sphere
  copy from `SimSide.teammate` (they do nothing without it).
- "Make Golden" in combat (Stolen Gold, Yu'lon Sticker, Golden Sandy) adds the card's base stats and
  switches to the golden card's script data.
- Unsupported (reported): Lock and Load (Deadeye; how the removed minion is "fired" is unclear),
  Wax Warband (its +X/+X lives in hero power script data 3, which the input does not carry),
  Battle Horn, Rylak/Assembler Portraits (battlecries / Auto Assembler not simulated). Dark Gift
  enchantments from the "Dark Gifts!" anomaly (Toreth's Blessing, Golemancy, ...) are ignored
  (which enchantment id carries the effect is unknown).
