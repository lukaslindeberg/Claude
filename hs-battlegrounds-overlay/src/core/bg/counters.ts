import type { BgCounters } from '@shared/types';
import type { CardDb } from '../cards/cardDb';
import type { EntityStore } from '../game/entityStore';
import { CardType, GameTag as T, Zone } from '../log/enums';

/**
 * Cards that track the current Beetle stats in TAG_SCRIPT_DATA_NUM_1/2 (Attack/Health;
 * 2/2 when unbuffed). Verified on fixture logs for BG31_801/803/809 and BG36_209.
 */
export const BEETLE_CARD_PREFIXES = ['BG31_801', 'BG31_803', 'BG31_807', 'BG31_808', 'BG31_809', 'BG32_204', 'BG34_Giant_687', 'BG36_209'];
const BEETLE_BASE = 2;

const REFRESH_BUTTON = 'TB_BaconShop_8p_Reroll_Button';
const FREE_REFRESH_ENCH = 'Bacon_Free_Refresh_Player_Ench';

/** Whether the Blood Gem / Beetle counters became relevant this game (kept sticky). */
export interface CounterRelevance {
  bloodGem: boolean;
  beetle: boolean;
}

export function isBeetleCard(cardId: string): boolean {
  return BEETLE_CARD_PREFIXES.some((p) => cardId.startsWith(p));
}

function mentionsBloodGem(db: CardDb, cardId: string): boolean {
  const c = db.get(cardId);
  if (!c) return false;
  return c.tribes.includes('QUILBOAR') || /blood gem/i.test(c.text ?? '') || /blood gem/i.test(c.name);
}

/**
 * Small in-game counters for the local player: Blood Gem and Beetle stats (only when
 * relevant), extra / overdrawn gold next turn and free refreshes (only when non-zero).
 */
export function localCounters(
  s: EntityStore,
  db: CardDb,
  localController: number,
  playerEntityId: number | undefined,
  heroEntityId: number | undefined,
  seen: CounterRelevance = { bloodGem: false, beetle: false },
): BgCounters | undefined {
  const pl = (tag: number) => s.tag(playerEntityId, tag) || s.tag(heroEntityId, tag);
  let gemRelevant = seen.bloodGem;
  let beetleRelevant = seen.beetle;
  let beetleAtk = 0;
  let beetleHp = 0;
  let refreshButton: { id: number; v: number } | undefined;
  let refreshEnch: number | undefined;
  for (const e of s.entities.values()) {
    if (e.tags.get(T.CONTROLLER) !== localController || !e.cardId) continue;
    const z = e.tags.get(T.ZONE);
    const live = z === Zone.PLAY || z === Zone.HAND;
    if (isBeetleCard(e.cardId)) {
      // Beetle stats only grow during a game: the highest copy is the current value.
      beetleAtk = Math.max(beetleAtk, e.tags.get(T.TAG_SCRIPT_DATA_NUM_1) ?? 0);
      beetleHp = Math.max(beetleHp, e.tags.get(T.TAG_SCRIPT_DATA_NUM_2) ?? 0);
      if (live) beetleRelevant = true;
    }
    if (!live) continue;
    if (e.cardId === REFRESH_BUTTON) {
      if (!refreshButton || e.id > refreshButton.id) refreshButton = { id: e.id, v: e.tags.get(T.BACON_FREE_REFRESH_COUNT) ?? 0 };
    } else if (e.cardId === FREE_REFRESH_ENCH) {
      refreshEnch = Math.max(refreshEnch ?? 0, e.tags.get(T.BACON_FREE_REFRESH_COUNT) ?? 0);
    } else if (!gemRelevant && e.tags.get(T.CARDTYPE) !== CardType.ENCHANTMENT && mentionsBloodGem(db, e.cardId)) {
      gemRelevant = true;
    }
  }

  const out: BgCounters = {};
  const gemAtk = pl(T.BACON_BLOODGEMBUFFATKVALUE);
  const gemHp = pl(T.BACON_BLOODGEMBUFFHEALTHVALUE);
  if (gemAtk > 0 || gemHp > 0) gemRelevant = true;
  seen.bloodGem = gemRelevant;
  if (gemRelevant) out.bloodGem = { attack: 1 + gemAtk, health: 1 + gemHp };
  const bA = Math.max(beetleAtk, BEETLE_BASE);
  const bH = Math.max(beetleHp, BEETLE_BASE);
  if (bA > BEETLE_BASE || bH > BEETLE_BASE) beetleRelevant = true;
  seen.beetle = beetleRelevant;
  if (beetleRelevant) out.beetle = { attack: bA, health: bH };
  const extra = pl(T.BACON_PLAYER_EXTRA_GOLD_NEXT_TURN);
  if (extra > 0) out.extraGoldNextTurn = extra;
  const overdrawn = pl(T.BACON_PLAYER_OVERDRAWN_GOLD_NEXT_TURN);
  if (overdrawn > 0) out.overdrawnGoldNextTurn = overdrawn;
  const free = refreshButton?.v ?? refreshEnch ?? s.tag(playerEntityId, T.BACON_FREE_REFRESH_COUNT);
  if (free > 0) out.freeRefreshes = free;
  return Object.keys(out).length ? out : undefined;
}
