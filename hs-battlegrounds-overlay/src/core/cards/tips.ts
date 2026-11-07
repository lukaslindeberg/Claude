import type { PlayTip } from '@shared/types';
import { CardDb } from './cardDb';
import tipsData from './data/tips.json';

/**
 * Short play tips for heroes and trinkets that need a specific approach.
 * Keyed by base hero card id or trinket id (see data/tips.json).
 */
const TIPS: readonly PlayTip[] = tipsData as PlayTip[];
const byId = new Map<string, PlayTip>(TIPS.map((t) => [t.cardId, t]));

/** Hero power id -> hero id, built lazily per card db. */
const heroByPowerCache = new WeakMap<CardDb, Map<string, string>>();

function heroByPower(db: CardDb): Map<string, string> {
  let m = heroByPowerCache.get(db);
  if (!m) {
    m = new Map();
    for (const c of db.data.cards) {
      if (c.type === 'HERO' && c.heroPowerId && !c.skinParentId && !m.has(c.heroPowerId)) m.set(c.heroPowerId, c.id);
    }
    heroByPowerCache.set(db, m);
  }
  return m;
}

/** Strip a trinket variant suffix (greater "_t", "_t2", ...) to its stem. */
const trinketStem = (id: string): string => id.replace(/t\d*$/, '');

/** All play tips. */
export function allPlayTips(): readonly PlayTip[] {
  return TIPS;
}

/**
 * Play tip for a hero, hero skin, hero power, trinket (lesser or greater) or
 * golden/variant card id. Returns undefined when the card needs no special guidance.
 */
export function getPlayTip(cardId: string, db: CardDb = CardDb.bundled()): PlayTip | undefined {
  if (!cardId) return undefined;
  const direct = byId.get(cardId);
  if (direct) return direct;

  const card = db.get(cardId);

  // Hero skins -> base hero.
  const base = db.baseHeroId(cardId);
  if (base !== cardId && byId.has(base)) return byId.get(base);

  // Hero power -> its hero (also covers powers whose hero is a skin).
  const hero = heroByPower(db).get(cardId);
  if (hero) return byId.get(db.baseHeroId(hero));

  // Golden / normal variants.
  const normal = db.normalOf(cardId);
  if (normal !== cardId && byId.has(normal)) return byId.get(normal);

  // Trinket variants (lesser <-> greater) that share the id stem and name.
  if (card?.type === 'TRINKET') {
    const stem = trinketStem(cardId);
    for (const t of TIPS) {
      if (trinketStem(t.cardId) !== stem) continue;
      const other = db.get(t.cardId);
      if (other?.type === 'TRINKET' && other.name === card.name) return t;
    }
  }
  return undefined;
}
