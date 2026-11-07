import { describe, expect, it } from 'vitest';
import { LOBBY_TRIBES } from '../../src/shared/types';
import { CardDb } from '../../src/core/cards/cardDb';
import { allPlayTips, getPlayTip } from '../../src/core/cards/tips';

const db = CardDb.bundled();
const tips = allPlayTips();

describe('play tips data', () => {
  it('has tips', () => {
    expect(tips.length).toBeGreaterThan(50);
  });

  it('every tip points at a draftable base hero or a trinket', () => {
    for (const t of tips) {
      const card = db.get(t.cardId);
      expect(card, t.cardId).toBeDefined();
      expect(['HERO', 'TRINKET'], t.cardId).toContain(card!.type);
      if (card!.type === 'HERO') {
        expect(card!.mechanics, t.cardId).toContain('BACON_HERO_CAN_BE_DRAFTED');
        expect(card!.skinParentId, t.cardId).toBeUndefined();
      }
    }
  });

  it('tips are non-empty and short', () => {
    for (const t of tips) {
      expect(t.tip.trim().length, t.cardId).toBeGreaterThan(0);
      expect(t.tip.length, t.cardId).toBeLessThan(240);
    }
  });

  it('has no duplicate ids', () => {
    const ids = tips.map((t) => t.cardId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wantsTribes uses valid lobby tribes', () => {
    for (const t of tips) {
      if (t.wantsTribes === undefined) continue;
      expect(t.wantsTribes.length, t.cardId).toBeGreaterThan(0);
      expect(new Set(t.wantsTribes).size, t.cardId).toBe(t.wantsTribes.length);
      for (const tribe of t.wantsTribes) expect(LOBBY_TRIBES, t.cardId).toContain(tribe);
    }
  });
});

describe('getPlayTip', () => {
  it('finds tips by base id', () => {
    expect(getPlayTip('TB_BaconShop_HERO_76')?.cardId).toBe('TB_BaconShop_HERO_76');
    expect(getPlayTip('BG30_MagicItem_434')?.cardId).toBe('BG30_MagicItem_434');
  });

  it('resolves hero skins to the base hero', () => {
    const skin = db.data.cards.find((c) => c.type === 'HERO' && c.skinParentId === 'BG20_HERO_101');
    expect(skin).toBeDefined();
    expect(getPlayTip(skin!.id)?.cardId).toBe('BG20_HERO_101');
    // Skin missing from the data falls back to stripping the suffix.
    expect(getPlayTip('BG20_HERO_101_SKIN_ZZ9')?.cardId).toBe('BG20_HERO_101');
  });

  it('resolves hero powers to their hero', () => {
    expect(getPlayTip('TB_BaconShop_HP_086')?.cardId).toBe('TB_BaconShop_HERO_76');
    const hero = db.get('BG26_HERO_104');
    expect(getPlayTip(hero!.heroPowerId!)?.cardId).toBe('BG26_HERO_104');
  });

  it('resolves trinket variants with the same name and stem', () => {
    // Greater Nomi Sticker -> lesser tip.
    expect(getPlayTip('BG30_MagicItem_544t')?.cardId).toBe('BG30_MagicItem_544');
    // Lesser Dalaran Cheese Wheel -> greater tip.
    expect(getPlayTip('BG30_MagicItem_879')?.cardId).toBe('BG30_MagicItem_879t');
    // Fishy Sticker shares a stem with Fish Portrait but is a different card.
    expect(getPlayTip('BG30_MagicItem_821t2')).toBeUndefined();
  });

  it('returns undefined for cards without tips', () => {
    expect(getPlayTip('')).toBeUndefined();
    expect(getPlayTip('TB_BaconShop_HERO_34')).toBeUndefined();
    expect(getPlayTip('NOT_A_CARD')).toBeUndefined();
  });
});
