/**
 * Helpers to build simulator inputs in tests.
 *
 *   const input = battle(side([minion('BG28_300'), minion('X', { attack: 3, health: 3 })]), side([...]));
 */
import type { BattleSimInput, MinionKeywords, MinionSnapshot, SimSide, Tribe } from '@shared/types';
import { CardDb } from '../../src/core/cards/cardDb';

export const db = CardDb.bundled();

let nextEntity = 1;

export interface MinionOpts {
  attack?: number;
  health?: number;
  golden?: boolean;
  tier?: number;
  tribes?: Tribe[];
  keywords?: MinionKeywords;
  enchantments?: string[];
  tags?: Record<string, number>;
}

/**
 * MinionSnapshot from a card id (stats, tribes, tier and keywords from the card
 * data, golden version when `golden`). Unknown ids produce a vanilla minion
 * (default 1/1) - handy for rule tests.
 */
export function minion(cardId: string, opts: MinionOpts = {}): MinionSnapshot {
  let id = cardId;
  if (opts.golden) id = db.goldenOf(cardId) ?? cardId;
  const card = db.get(id);
  const mech = new Set(card?.mechanics ?? []);
  const keywords: MinionKeywords = {
    taunt: mech.has('TAUNT'),
    divineShield: mech.has('DIVINE_SHIELD'),
    poisonous: mech.has('POISONOUS'),
    venomous: mech.has('VENOMOUS'),
    windfury: mech.has('WINDFURY'),
    megaWindfury: mech.has('MEGA_WINDFURY'),
    reborn: mech.has('REBORN'),
    stealth: mech.has('STEALTH'),
    cleave: mech.has('CLEAVE'),
    deathrattle: mech.has('DEATHRATTLE'),
    startOfCombat: mech.has('START_OF_COMBAT'),
    avenge: mech.has('AVENGE'),
    ...opts.keywords,
  };
  const attack = opts.attack ?? card?.attack ?? 1;
  const health = opts.health ?? card?.health ?? 1;
  const entityId = nextEntity++;
  return {
    entityId,
    cardId: id,
    name: card?.name ?? cardId,
    attack,
    health,
    maxHealth: health,
    golden: !!opts.golden || !!card?.golden,
    tier: opts.tier ?? card?.tier ?? db.tier(id),
    tribes: opts.tribes ?? card?.tribes ?? [],
    position: 0,
    keywords,
    enchantments: (opts.enchantments ?? []).map((e, i) => ({ entityId: entityId * 100 + i, cardId: e })),
    tags: opts.tags ?? {},
  };
}

/** Vanilla test minion with explicit stats. */
export function vanilla(attack: number, health: number, keywords: MinionKeywords = {}, tier = 1): MinionSnapshot {
  return minion('TEST_VANILLA', { attack, health, keywords, tier });
}

export function side(minions: MinionSnapshot[], opts: Partial<SimSide> = {}): SimSide {
  minions.forEach((m, i) => (m.position = i + 1));
  return {
    playerId: 1,
    heroCardId: 'TB_BaconShop_HERO_01',
    tavernTier: 1,
    health: 30,
    armor: 0,
    minions,
    hand: [],
    trinkets: [],
    questRewards: [],
    playerTags: {},
    heroTags: {},
    ...opts,
  };
}

export function battle(player: SimSide, opponent: SimSide, extra: Partial<BattleSimInput> = {}): BattleSimInput {
  return {
    turn: 10,
    player,
    opponent: { ...opponent, playerId: 2 },
    availableTribes: [],
    mode: 'solo',
    ...extra,
  };
}
