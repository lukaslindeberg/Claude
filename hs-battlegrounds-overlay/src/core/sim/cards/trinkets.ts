/** Trinkets with combat effects (side-level effects). */
import { registerEffect, registerEnchantment } from './registry';
import {
  aliveMinions,
  attackImmediately,
  buff,
  buffAll,
  copyMinion,
  destroy,
  endAnchor,
  giveDivineShield,
  giveReborn,
  giveTaunt,
  hasNoTribe,
  hasTribe,
  highestInHand,
  isRallyMinion,
  leftMost,
  minionFromCard,
  minionFromSnapshot,
  playBloodGem,
  queueSpaceSummon,
  randomFriendlies,
  randomFriendly,
  rightMost,
  rightOfAnchor,
  summon,
  summonBeetles,
  summonForDeath,
  triggerDeathrattlesArtificially,
  hasDeathrattle,
  tribeFilter,
} from './helpers';
import {
  dealDamage,
  giveDivineShield as shield,
  improveUndeadAttack,
  minionFromSnapshot as fromSnapshot,
  randomPoolMinion,
  buffAll as buffEach,
} from './helpers';
import { cardsAddedToHand } from './aberration';
import { makeGolden, teammateHighest } from './neutral';
import { LOBBY_TRIBES } from '@shared/types';
import type { Battle, DeathrattleFn, EffectInstance, Minion } from '../engine/types';

/** Trinket script data: tracker value, else the card's own TAG_SCRIPT_DATA_NUM_n, else `fallback`. */
function esd(b: Battle, e: EffectInstance, n: 1 | 2 | 3, fallback: number): number {
  const v = n === 1 ? e.scriptData1 : n === 2 ? e.scriptData2 : undefined;
  if (typeof v === 'number' && v > 0) return v;
  const c = b.db.get(e.cardId)?.tags?.[`TAG_SCRIPT_DATA_NUM_${n}`];
  return typeof c === 'number' ? c : fallback;
}

const isBeast = tribeFilter('BEAST');
const isDragon = tribeFilter('DRAGON');
const isUndead = tribeFilter('UNDEAD');
const isNaga = tribeFilter('NAGA');
const isMurloc = tribeFilter('MURLOC');
const isPirate = tribeFilter('PIRATE');
const isElemental = tribeFilter('ELEMENTAL');

function grant(m: Minion, sourceCardId: string, fn: DeathrattleFn): void {
  if (m.enchantments.includes(sourceCardId)) return;
  m.extraDeathrattles.push({ sourceCardId, golden: false, fn });
}

function leftAndRight(side: EffectInstance['side'], filter?: (m: Minion) => boolean): Minion[] {
  const l = leftMost(side, filter);
  const r = rightMost(side, filter);
  return l && r && l !== r ? [l, r] : l ? [l] : [];
}

function perCombat(e: EffectInstance, key: string, max: number): boolean {
  const used = e.data[key] ?? 0;
  if (used >= max) return false;
  e.data[key] = used + 1;
  return true;
}

/** Sky Golem Portrait: "Deathrattle: Give your minions +3/+3 permanently." */
const SKYWARD_DR: DeathrattleFn = (b, self) => buffAll(b, self.side, 3, 3);
/** Jarred Frostling: "Deathrattle: Summon a Flourishing Frostling." */
const FROSTLING_DR: DeathrattleFn = (b, self, ctx) => {
  summonForDeath(b, self, ctx, 'BG26_537', 1);
};
/** Powder Keg: "Deathrattle: Summon a 1/1 Sky Pirate and give it this minion's Attack. It attacks immediately." */
const POWDER_KEG_DR: DeathrattleFn = (b, self, ctx) => {
  const [p] = summonForDeath(b, self, ctx, 'BGS_061t', 1);
  if (!p) return;
  buff(b, p, self.attack, 0);
  attackImmediately(b, p);
};

export function registerTrinkets(): void {
  registerEnchantment(['BG35_MagicItem_740e', 'BG35_MagicItem_740e2'], { deathrattle: SKYWARD_DR });
  registerEnchantment('BG30_MagicItem_952e', { deathrattle: FROSTLING_DR });

  // Valorous Medallion: Start of Combat: Give your minions +2/+2 (greater: +6/+6).
  registerEffect('BG30_MagicItem_970', { startOfCombat: (b, e) => buffAll(b, e.side, 2, 2) });
  registerEffect('BG30_MagicItem_970t', { startOfCombat: (b, e) => buffAll(b, e.side, 6, 6) });
  // Holy Mallet: Start of Combat: Give your left and right-most minions Divine Shield.
  registerEffect('BG30_MagicItem_902', {
    startOfCombat: (b, e) => leftAndRight(e.side).forEach((m) => giveDivineShield(b, m)),
  });
  // Ceremonial Sword: Whenever a friendly minion attacks, give it +4 Attack.
  registerEffect('BG30_MagicItem_925', { onFriendlyAttack: (b, _e, attacker) => buff(b, attacker, 4, 0) });
  // Training Certificate: Start of Combat: Double the stats of your two lowest-Attack minions.
  registerEffect('BG30_MagicItem_962', {
    startOfCombat: (b, e) => {
      const sorted = aliveMinions(e.side).sort((x, y) => x.attack - y.attack);
      for (const m of sorted.slice(0, 2)) buff(b, m, m.attack, m.health);
    },
  });
  // Bronze Timepiece: Start of Combat: Give each of your minions Health equal to half its Attack.
  registerEffect('BG30_MagicItem_995', {
    startOfCombat: (b, e) => aliveMinions(e.side).forEach((m) => buff(b, m, 0, Math.floor(m.attack / 2))),
  });
  // Bird Feeder: Avenge (2): Give your minions +1/+1 (greater: +4/+4).
  registerEffect('BG32_MagicItem_864', { avenge: 2, onAvenge: (b, e) => buffAll(b, e.side, 1, 1) });
  registerEffect('BG32_MagicItem_864t', { avenge: 2, onAvenge: (b, e) => buffAll(b, e.side, 4, 4) });
  // Karazhan Chess Set: Start of Combat: Summon a copy of your left-most minion.
  registerEffect('BG30_MagicItem_972', {
    startOfCombat: (b, e) => {
      const m = leftMost(e.side);
      if (m) summon(b, e.side, copyMinion(b, m), rightOfAnchor(m));
    },
  });
  // Lightfeather Sticker: Start of Combat: Give your Rally minions Divine Shield.
  registerEffect('BG36_MagicItem_213', {
    startOfCombat: (b, e) => aliveMinions(e.side).forEach((m) => isRallyMinion(b, m) && giveDivineShield(b, m)),
  });
  // Protective Ring: Start of Combat: Give 4 random friendly Pirates Divine Shield.
  registerEffect('BG35_MagicItem_711', {
    startOfCombat: (b, e) =>
      randomFriendlies(b, e.side, 4, (m) => isPirate(m) && !m.divineShield).forEach((m) => giveDivineShield(b, m)),
  });
  // Hogwash Basin: Start of Combat: This plays 3 Blood Gems on all your minions.
  registerEffect('BG32_MagicItem_904', {
    startOfCombat: (b, e) => aliveMinions(e.side).forEach((m) => playBloodGem(b, m, 3)),
  });
  // Baleful Incense: Start of Combat: Give your left and right-most Undead Reborn.
  registerEffect('BG32_MagicItem_360', {
    startOfCombat: (_b, e) => leftAndRight(e.side, isUndead).forEach(giveReborn),
  });
  // Emerald Dreamcatcher: Start of Combat: Set your Dragons' Attack to the highest in your warband.
  registerEffect('BG30_MagicItem_542', {
    startOfCombat: (b, e) => {
      const all = aliveMinions(e.side);
      const max = all.reduce((a, m) => Math.max(a, m.attack), 0);
      for (const m of all) if (isDragon(m) && m.attack < max) buff(b, m, max - m.attack, 0);
    },
  });
  // Ironforge Anvil: Start of Combat: Triple the stats of your minions with no type.
  registerEffect('BG30_MagicItem_403', {
    startOfCombat: (b, e) => aliveMinions(e.side).forEach((m) => hasNoTribe(m) && buff(b, m, m.attack * 2, m.health * 2)),
  });
  // Slamma Sticker: After you summon a Beast in combat, double its Attack.
  registerEffect('BG30_MagicItem_540', {
    afterFriendlySummon: (b, _e, m) => {
      if (isBeast(m)) buff(b, m, m.attack, 0);
    },
  });
  // Faerie Dragon Scale: Whenever a friendly Dragon attacks, give it Divine Shield. (3 times per combat.)
  registerEffect('BG32_MagicItem_363', {
    onFriendlyAttack: (b, e, attacker) => {
      if (isDragon(attacker) && !attacker.divineShield && perCombat(e, 'uses', 3)) giveDivineShield(b, attacker);
    },
  });
  // Herald Sticker: Start of Combat: Trigger all friendly Deathrattles.
  registerEffect('BG32_MagicItem_306', {
    startOfCombat: (b, e) => aliveMinions(e.side).filter(hasDeathrattle).forEach((m) => triggerDeathrattlesArtificially(b, m)),
  });
  // Myrmidon Sticker: Start of Combat: Double your left and right-most Naga's stats.
  registerEffect('BG36_MagicItem_361', {
    startOfCombat: (b, e) => leftAndRight(e.side, isNaga).forEach((m) => buff(b, m, m.attack, m.health)),
  });
  // Stegodon Portrait: Start of Combat: Give your two left-most Beasts Divine Shield.
  registerEffect('BG35_MagicItem_702', {
    startOfCombat: (b, e) => aliveMinions(e.side).filter(isBeast).slice(0, 2).forEach((m) => giveDivineShield(b, m)),
  });
  // Eternal Portrait: Start of Combat: Give your Eternal Knights Taunt and Reborn.
  registerEffect('BG30_MagicItem_301', {
    startOfCombat: (_b, e) =>
      aliveMinions(e.side)
        .filter((m) => m.cardId.startsWith('BG25_008'))
        .forEach((m) => {
          giveTaunt(m);
          giveReborn(m);
        }),
  });
  // Eternal Portrait (greater): After a friendly Undead dies, your Eternal Knights have +4/+2 this game.
  registerEffect('BG36_MagicItem_216', {
    onFriendlyDeath: (b, e, dead) => {
      if (!isUndead(dead)) return;
      for (const m of aliveMinions(e.side)) if (m.cardId.startsWith('BG25_008')) buff(b, m, 4 * m.mult, 2 * m.mult);
    },
  });
  // Rivendare Portrait: Start of Combat: Double the Health of your Titus Rivendares.
  registerEffect('BG30_MagicItem_310', {
    startOfCombat: (b, e) =>
      aliveMinions(e.side)
        .filter((m) => m.cardId.startsWith('BG25_354'))
        .forEach((m) => buff(b, m, 0, m.health)),
  });
  // Converter Portrait: Start of Combat: Give your Faceless Converters Reborn.
  registerEffect('BG36_MagicItem_600', {
    startOfCombat: (_b, e) => aliveMinions(e.side).filter((m) => m.cardId.startsWith('BG36_318')).forEach(giveReborn),
  });
  // Valdrakken Wind Chimes: Your Start of Combat effects trigger an extra time.
  registerEffect('BG32_MagicItem_365', { init: (_b, e) => void (e.side.socMultiplier += 1) });
  // Promo Portrait: Your first Start of Combat effect each combat triggers an extra time.
  registerEffect('BG30_MagicItem_918', { init: (_b, e) => void (e.side.nextStartOfCombatBonus += 1) });
  // Deathly Phylactery: Your first Deathrattle each combat triggers an extra time.
  registerEffect('BG30_MagicItem_700', { init: (_b, e) => void (e.side.nextDeathrattleBonus += 1) });
  // Deathwhisper Sticker: After a friendly minion is Reborn, give your minions +2/+2.
  registerEffect('BG36_MagicItem_205', { onFriendlyReborn: (b, e) => buffAll(b, e.side, 2, 2) });
  // Deathtouch Apple: After a friendly Undead is Reborn, give it Reborn. (3 times.)
  registerEffect('BG35_MagicItem_731', {
    onFriendlyReborn: (_b, e, m) => {
      if (isUndead(m) && perCombat(e, 'uses', 3)) giveReborn(m);
    },
  });
  // Lionfish Portrait: Whenever a friendly Beast attacks, give it +4/+2.
  registerEffect('BG36_MagicItem_201', {
    onFriendlyAttack: (b, _e, attacker) => {
      if (isBeast(attacker)) buff(b, attacker, 4, 2);
    },
  });
  // All-Purpose Kibble: Whenever a friendly Beast attacks, give it +4 Attack (improves).
  registerEffect('BG32_MagicItem_200', {
    onFriendlyAttack: (b, e, attacker) => {
      if (isBeast(attacker)) buff(b, attacker, Math.max(4, e.scriptData1 ?? 4), 0);
    },
  });
  // Unholy Sanctum: After you trigger a Deathrattle, give your right-most minion +2/+2 (greater +6/+4).
  registerEffect('BG32_MagicItem_862', {
    onDeathrattleTriggered: (b, e) => {
      const m = rightMost(e.side);
      if (m) buff(b, m, 2, 2);
    },
  });
  registerEffect('BG32_MagicItem_862t', {
    onDeathrattleTriggered: (b, e) => {
      const m = rightMost(e.side);
      if (m) buff(b, m, 6, 4);
    },
  });
  // Beetle Band: Avenge (5): Summon a 2/2 Beetle with Taunt (greater: Avenge (8), two Beetles).
  registerEffect('BG32_MagicItem_860', {
    avenge: 5,
    onAvenge: (b, e) => summonBeetles(b, e.side, 1, endAnchor(e.side)).forEach(giveTaunt),
  });
  registerEffect('BG32_MagicItem_860t', {
    avenge: 8,
    onAvenge: (b, e) => summonBeetles(b, e.side, 2, endAnchor(e.side)).forEach(giveTaunt),
  });
  // Fang Anklet: Start of Combat: Your Beasts have +1/+1 this combat (improves).
  registerEffect('BG35_MagicItem_701', {
    startOfCombat: (b, e) => {
      const a = Math.max(1, e.scriptData1 ?? 1);
      const h = Math.max(1, e.scriptData2 ?? 1);
      buffAll(b, e.side, a, h, isBeast);
      e.side.summonBuffs.push({ tribe: 'BEAST', attack: a, health: h });
    },
  });
  // Alliance Keychain: The first time a friendly minion dies each combat, give its maximum stats to a
  // random friendly minion (greater: 2).
  const keychain = (n: number) => ({
    onFriendlyDeath: (b: Battle, e: EffectInstance, dead: Minion) => {
      if (!perCombat(e, 'fired', 1)) return;
      for (const m of randomFriendlies(b, e.side, n)) buff(b, m, dead.attack, dead.maxHealth);
    },
  });
  registerEffect('BG30_MagicItem_433', keychain(1));
  registerEffect('BG30_MagicItem_433t', keychain(2));
  // Bassgill Portrait: After you summon a Murloc in combat, give it Divine Shield.
  registerEffect('BG32_MagicItem_301', {
    afterFriendlySummon: (b, _e, m) => {
      if (isMurloc(m)) giveDivineShield(b, m);
    },
  });
  // Blingtron's Sunglasses: After you summon a Mech in combat, give a friendly Mech Divine Shield.
  registerEffect('BG30_MagicItem_978', {
    afterFriendlySummon: (b, e, m) => {
      if (!hasTribe(m, 'MECHANICAL')) return;
      const t = randomFriendly(b, e.side, (x) => hasTribe(x, 'MECHANICAL') && !x.divineShield);
      if (t) giveDivineShield(b, t);
    },
  });
  // Staff of the Scourge: Avenge (5): Give a random friendly Undead Reborn.
  registerEffect('BG30_MagicItem_437', {
    avenge: 5,
    onAvenge: (b, e) => {
      const t = randomFriendly(b, e.side, (m) => isUndead(m) && !m.reborn);
      if (t) giveReborn(t);
    },
  });
  // Sky Golem Portrait: Start of Combat: Give your minions "Deathrattle: Give your minions +3/+3 permanently."
  registerEffect('BG35_MagicItem_740', {
    startOfCombat: (_b, e) => aliveMinions(e.side).forEach((m) => grant(m, 'BG35_MagicItem_740e', SKYWARD_DR)),
  });
  // Jarred Frostling: Start of Combat: Give 3 friendly Elementals "Deathrattle: Summon a Flourishing Frostling".
  registerEffect('BG30_MagicItem_952', {
    startOfCombat: (b, e) =>
      randomFriendlies(b, e.side, 3, isElemental).forEach((m) => grant(m, 'BG30_MagicItem_952e', FROSTLING_DR)),
  });
  // Powder Keg: Start of Combat: Give 3 friendly Pirates "Deathrattle: Summon a 1/1 Sky Pirate ...".
  registerEffect('BG35_MagicItem_714', {
    startOfCombat: (b, e) =>
      randomFriendlies(b, e.side, 3, isPirate).forEach((m) => grant(m, 'BG35_MagicItem_714e', POWDER_KEG_DR)),
  });
  // Automaton Portrait: Start of Combat: When you have space, summon an Ancestral Automaton.
  registerEffect('BG30_MagicItem_303', {
    startOfCombat: (_b, e) =>
      queueSpaceSummon(e.side, { remaining: 1, make: (bb, s) => minionFromCard(bb, s, 'BG_TTN_401') }),
  });
  // Crocheted Sungill: Start of Combat: Give the highest-Health minion from your hand +4/+4. When you
  // have space, summon it for this combat only.
  registerEffect('BG32_MagicItem_960', {
    startOfCombat: (b, e) => {
      const card = highestInHand(b, e.side, 'health');
      if (!card) return;
      const i = e.side.hand.indexOf(card);
      if (i >= 0) e.side.hand.splice(i, 1);
      queueSpaceSummon(e.side, {
        remaining: 1,
        make: (bb, s) => {
          const m = minionFromSnapshot(bb, s, { ...card.snapshot, entityId: bb.nextEntityId++ });
          m.attack += 4;
          m.health += 4;
          m.maxHealth += 4;
          return m;
        },
      });
    },
  });
  // Tinyfin Onesie: Start of Combat: Your left-most minion gains the stats of the highest-Health minion in your hand.
  registerEffect('BG30_MagicItem_441', {
    startOfCombat: (b, e) => {
      const card = highestInHand(b, e.side, 'health');
      const m = leftMost(e.side);
      if (card && m) buff(b, m, card.attack, card.health);
    },
  });
  // Dramaloc Sticker: Start of Combat: Give your Murlocs the Attack of the highest-Attack minion in your hand.
  registerEffect('BG35_MagicItem_754', {
    startOfCombat: (b, e) => {
      const card = highestInHand(b, e.side, 'attack');
      if (card) buffAll(b, e.side, card.attack, 0, isMurloc);
    },
  });
  // Twin Sky Lanterns: When you have space, summon a copy of the first minion you summon each combat.
  const lanterns = (n: number) => ({
    afterFriendlySummon: (b: Battle, e: EffectInstance, m: Minion) => {
      if (e.data.done) return;
      e.data.done = 1;
      const copy = copyMinion(b, m);
      queueSpaceSummon(e.side, { remaining: n, make: (bb) => copyMinion(bb, copy) });
    },
  });
  registerEffect('BG30_MagicItem_822', lanterns(1));
  registerEffect('BG30_MagicItem_822t2', lanterns(2));
  // S'Thara Sticker: After your last minion dies each combat, summon your first Demon that died with
  // its maximum stats.
  registerEffect('BG32_MagicItem_907', {
    onBoardEmpty: (b, e) => {
      if (e.data.done) return;
      const demon = e.side.deadThisCombat.find((m) => hasTribe(m, 'DEMON'));
      if (!demon) return;
      e.data.done = 1;
      const m = copyMinion(b, demon);
      m.health = m.maxHealth;
      summon(b, e.side, m, endAnchor(e.side));
    },
  });
  // Soul Fermenter: Start of Combat: Destroy your 3 left-most minions. After your last minion dies,
  // resummon them.
  registerEffect('BG35_MagicItem_732', {
    startOfCombat: (b, e) => {
      const victims = aliveMinions(e.side).slice(0, 3);
      const copies = victims.map((m) => copyMinion(b, m));
      for (const v of victims) destroy(b, v);
      e.data.pending = 1;
      e.stash = copies;
    },
    onBoardEmpty: (b, e) => {
      if (!e.data.pending) return;
      e.data.pending = 0;
      const copies = e.stash ?? [];
      for (const c of copies) summon(b, e.side, copyMinion(b, c), endAnchor(e.side));
    },
  });
  // Boom Controller: When you have space, summon an exact copy of your first Mech that died each combat.
  registerEffect('BG30_MagicItem_440', {
    onFriendlyDeath: (b, e, dead) => {
      if (e.data.done || !hasTribe(dead, 'MECHANICAL')) return;
      e.data.done = 1;
      const copy = copyMinion(b, dead);
      copy.health = copy.maxHealth;
      queueSpaceSummon(e.side, { remaining: 1, make: () => copy });
    },
  });
  // Evil Experiment: After your Deity awakens, give it Reborn.
  registerEffect('BG36_MagicItem_416', { onDeityAwakened: (_b, _e, deity) => giveReborn(deity) });
  // Eclectic Shrine: Start of Combat: Give a friendly minion of each different type +3/+2 (improves).
  registerEffect('BG32_MagicItem_280', {
    startOfCombat: (b, e) => {
      const a = Math.max(3, e.scriptData1 ?? 3);
      const h = Math.max(2, e.scriptData2 ?? 2);
      const used = new Set<Minion>();
      for (const tribe of LOBBY_TRIBES) {
        const t = randomFriendly(b, e.side, (m) => !used.has(m) && m.tribes.length > 0 && hasTribe(m, tribe));
        if (!t) continue;
        used.add(t);
        buff(b, t, a, h);
      }
    },
  });

  // --- group-2 audit additions -------------------------------------------------------------

  // Ship in a Bottle: Start of Combat: Summon and get a random Pirate. It attacks immediately.
  registerEffect('BG30_MagicItem_407', {
    startOfCombat: (b, e) => {
      const card = randomPoolMinion(b, 'pirate', (c) => c.tribes.includes('PIRATE'));
      if (!card) return;
      cardsAddedToHand(b, e.side, 1);
      const m = minionFromCard(b, e.side, card.id);
      if (summon(b, e.side, m, endAnchor(e.side))) attackImmediately(b, m);
    },
  });
  // Tiger Carving: Whenever a friendly minion takes damage, give another friendly minion +3/+1
  // (greater: +6/+2) permanently.
  registerEffect(['BG30_MagicItem_427', 'BG30_MagicItem_427t'], {
    onFriendlyDamaged: (b, e, damaged) => {
      const t = randomFriendly(b, e.side, undefined, damaged);
      if (t) buff(b, t, esd(b, e, 1, 3), esd(b, e, 2, 1));
    },
  });
  // Comfy Coffin: Whenever you cast a Tavern spell, your Undead have +1 (greater: +2) Attack this game.
  registerEffect('BG30_MagicItem_547', { onSpellCast: (b, e) => improveUndeadAttack(b, e.side, 1) });
  registerEffect('BG30_MagicItem_547t', { onSpellCast: (b, e) => improveUndeadAttack(b, e.side, 2) });
  // Lorewalker Scroll: Whenever you cast a spell on a minion, give it +4/+4 (greater: +10/+10).
  registerEffect(['BG30_MagicItem_422', 'BG30_MagicItem_422t'], {
    onSpellCast: (b, e, _spell, target) => {
      if (target && target.side === e.side) buff(b, target, esd(b, e, 1, 4), esd(b, e, 2, 4));
    },
  });
  // Fishy Sticker (greater): Start of Combat: Summon a Golden Fish of N'Zoth.
  registerEffect('BG30_MagicItem_821t2', {
    startOfCombat: (b, e) => {
      summon(b, e.side, minionFromCard(b, e.side, 'TB_BaconShop_HP_105t', { golden: true }), endAnchor(e.side));
    },
  });
  // Gilnean Thorned Rose: Avenge (3): Give your minions +4/+X permanently and deal 1 damage to them.
  registerEffect('BG30_MagicItem_864', {
    avenge: 3,
    onAvenge: (b, e) => {
      const a = esd(b, e, 2, 4);
      const h = esd(b, e, 3, 5);
      for (const m of aliveMinions(e.side)) buff(b, m, a, h);
      for (const m of aliveMinions(e.side)) dealDamage(b, null, m, 1);
    },
  });
  // Reinforced Shield: Whenever you summon a minion, give it Divine Shield (5 times per combat).
  registerEffect('BG30_MagicItem_886', {
    onFriendlySummon: (b, e, m) => {
      if (perCombat(e, 'shield', 5)) shield(b, m);
    },
  });
  // Mechagon Adapter: After a friendly Mech loses Divine Shield, give it Divine Shield (3 times per combat).
  registerEffect('BG30_MagicItem_910', {
    onFriendlyDivineShieldLost: (b, e, m) => {
      if (!m.removed && m.health > 0 && hasTribe(m, 'MECHANICAL') && perCombat(e, 'shield', 3)) shield(b, m);
    },
  });
  // Wizard's Pipe: Whenever you cast a Tavern spell, give your minions with no type +4/+4.
  registerEffect('BG32_MagicItem_281', { onSpellCast: (b, e) => buffEach(b, e.side, 4, 4, hasNoTribe) });
  // Bluegill Flippers: Whenever you cast a Tavern spell, give the left-most minion in your hand and
  // warband +3/+3 (the hand part does not matter in combat).
  registerEffect('BG32_MagicItem_893', {
    onSpellCast: (b, e) => {
      const m = leftMost(e.side);
      if (m) buff(b, m, esd(b, e, 1, 3), esd(b, e, 2, 3));
    },
  });
  // Yu'lon Sticker: Start of Combat: Make your highest-Tier Dragon Golden.
  registerEffect('BG32_MagicItem_419', {
    startOfCombat: (b, e) => {
      const dragons = aliveMinions(e.side).filter((m) => isDragon(m) && !m.golden);
      const top = Math.max(...dragons.map((m) => m.tier));
      const m = b.rng.pick(dragons.filter((d) => d.tier === top));
      if (m) makeGolden(b, m);
    },
  });
  // Vash'jir Anemone: Start of Combat: Give your Naga +1 Health (improves with spells; script data 2).
  registerEffect('BG32_MagicItem_932', {
    startOfCombat: (b, e) => buffEach(b, e.side, 0, esd(b, e, 2, 1), isNaga),
  });
  // Scrapsmith Portrait: After a friendly minion with Taunt dies, play a permanent Blood Gem on your
  // Scrapsmiths.
  registerEffect('BG35_MagicItem_430', {
    onFriendlyDeath: (b, e, dead) => {
      if (!dead.taunt) return;
      for (const m of aliveMinions(e.side)) if (m.cardId.startsWith('BG24_707')) playBloodGem(b, m, 1);
    },
  });
  // Blood Amulet: After you trigger a Deathrattle, this plays a permanent Blood Gem on 3 random
  // friendly minions.
  registerEffect('BG35_MagicItem_432', {
    onDeathrattleTriggered: (b, e) => {
      for (const m of randomFriendlies(b, e.side, esd(b, e, 1, 3))) playBloodGem(b, m, 1);
    },
  });
  // Cloud Serpent Horn: Avenge (3): Give the Attack of your right-most minion to another friendly Dragon.
  registerEffect('BG35_MagicItem_849', {
    avenge: 3,
    onAvenge: (b, e) => {
      const r = rightMost(e.side);
      const t = r && randomFriendly(b, e.side, isDragon, r);
      if (r && t) buff(b, t, r.attack, 0);
    },
  });
  // Mama Bear Sticker: Whenever you summon a Beast, give it +7/+7.
  registerEffect('BG35_MagicItem_871', {
    onFriendlySummon: (b, e, m) => {
      if (isBeast(m)) buff(b, m, esd(b, e, 1, 7), esd(b, e, 2, 7));
    },
  });
  // Bewitched Ribbon: Whenever you cast a spell, give your minions +1/+1 permanently (+X/+X while in
  // combat; X = the card's script data 3).
  registerEffect('BG35_MagicItem_923', {
    onSpellCast: (b, e) => {
      const x = esd(b, e, 3, 2);
      buffEach(b, e.side, x, x);
    },
  });
  // Summoning Sphere (Duos): Start of Combat: Summon a copy of your teammate's highest-Health minion.
  registerEffect('BGDUO_MagicItem_003', {
    startOfCombat: (b, e) => {
      const t = teammateHighest(b, e.side, (s) => s.health);
      if (t) summon(b, e.side, fromSnapshot(b, e.side, { ...t, entityId: b.nextEntityId++ }), endAnchor(e.side));
    },
  });

  // Wicked Tome: Avenge (3): Your Tavern spells give an extra +1 Attack this game (greater: Avenge (4),
  // +1/+X). Matters for Tavern spells cast later in the same combat.
  registerEffect('BG32_MagicItem_270', { avenge: 3, onAvenge: (_b, e) => void (e.side.spellAttackBonus += 1) });
  registerEffect('BG32_MagicItem_270t', {
    avenge: 4,
    onAvenge: (b, e) => {
      e.side.spellAttackBonus += esd(b, e, 2, 1);
      e.side.spellHealthBonus += esd(b, e, 3, 1);
    },
  });
  // Quilligraphy Set: Avenge (3): Your Blood Gems give an extra +1 Health this game (greater:
  // Avenge (4): +1/+1). Affects Blood Gems played later in the same combat.
  registerEffect('BG30_MagicItem_410', { avenge: 3, onAvenge: (_b, e) => void (e.side.bloodGemHealth += 1) });
  registerEffect('BG30_MagicItem_410t2', {
    avenge: 4,
    onAvenge: (_b, e) => {
      e.side.bloodGemAttack += 1;
      e.side.bloodGemHealth += 1;
    },
  });
  // Cards gained in combat (only the hand count matters, for The Shadow of Doubt).
  // Fridge Magnet: Avenge (3): Get a random Magnetic minion.
  registerEffect('BG30_MagicItem_545', { avenge: 3, onAvenge: (b, e) => void cardsAddedToHand(b, e.side, 1) });
  // Funeral Wreath: After a friendly minion is Reborn, get a plain copy of it (3 times per combat).
  registerEffect('BG36_MagicItem_217', {
    onFriendlyReborn: (b, e) => {
      if (perCombat(e, 'copies', 3)) cardsAddedToHand(b, e.side, 1);
    },
  });

  // Trinkets without combat effects that mention combat words.
  registerEffect(
    [
      'BG30_MagicItem_411', // Hoggy Bank (deathrattle: get Blood Gems)
      'BG30_MagicItem_917', // Rusty Trident (deathrattle: get a spell)
      'BG30_MagicItem_981', // The Eye of Dalaran (get a spell)
      'BG36_MagicItem_200', // Herding Horn (free Refresh)
      'BG36_MagicItem_212', // Wolfhead Flail (end of turn)
      'BG36_MagicItem_208', // Floating Candle Set (spellcraft)
      'BG35_MagicItem_872', // Ophidian Staff (spellcraft)
      'BG32_MagicItem_417', // Tarecgosa Sticker
      'BG35_MagicItem_434', // Jewelry Box
      'BG36_MagicItem_362', // Cyclist Portrait
      'BG35_MagicItem_310', // Radio Star Portrait
    ],
    { noCombatEffect: true },
  );
}
