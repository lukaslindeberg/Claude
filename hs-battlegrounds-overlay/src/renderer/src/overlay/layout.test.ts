import { describe, expect, it } from 'vitest';
import { HS_ZONES, PICK_CARD_WIDTH, WIDGET_WIDTH, battleSimPlacement, bottomLeftMaxWidth, effectiveScale, heroPickCenters, overlaps, trinketPickLayout, zoneRect, type Rect } from './layout';

const SIZES: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [1920, 1200],
  [1440, 1080],
  [3440, 1440],
];
const SCALES = [0.8, 1, 1.2, 1.4];
/** Tallest the battle plaque gets at scale 1 (CSS px): odds, damage, unreliable line, actual result. */
const PLAQUE_HEIGHT = 150;

function plaqueRect(view: 'combat' | 'last', W: number, H: number, s: number): Rect {
  const p = battleSimPlacement(view, { width: W, height: H }, s);
  const w = WIDGET_WIDTH.sim * p.scale;
  return { left: p.right - w, top: p.top, width: w, height: PLAQUE_HEIGHT * p.scale };
}

describe('battle plaque placement', () => {
  for (const [W, H] of SIZES) {
    for (const scale of SCALES) {
      const vp = { width: W, height: H };
      const s = effectiveScale(scale, vp);
      it(`${W}x${H} @${scale}: clear of the opponent's portrait (combat) and Bob's buttons (shop)`, () => {
        const combat = plaqueRect('combat', W, H, s);
        expect(overlaps(combat, zoneRect(HS_ZONES.oppHero, vp))).toBe(false);
        expect(combat.left).toBeGreaterThanOrEqual(0);
        const shop = plaqueRect('last', W, H, s);
        expect(overlaps(shop, zoneRect(HS_ZONES.bob, vp))).toBe(false);
        expect(shop.left).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

describe('pick rows', () => {
  it('hero and trinket cards have room next to each other at scale 1 on 16:9', () => {
    const vp = { width: 1920, height: 1080 };
    const heroes = heroPickCenters(4, vp);
    expect(heroes[1] - heroes[0]).toBeGreaterThan(PICK_CARD_WIDTH.hero);
    const trinkets = trinketPickLayout(4, vp, 1);
    expect(trinkets.spacing).toBeGreaterThan(PICK_CARD_WIDTH.trinket);
  });

  it('trinket cards stay clear of the leaderboard panel', () => {
    for (const [W, H] of SIZES) {
      const vp = { width: W, height: H };
      const s = effectiveScale(1, vp);
      const { centers, spacing } = trinketPickLayout(4, vp, s);
      expect(centers[3] + spacing / 2).toBeLessThanOrEqual(W - WIDGET_WIDTH.oppPanel * s * 0.9);
    }
  });
});

describe('bottom-left widgets', () => {
  it('stay left of the hand', () => {
    for (const [W, H] of SIZES) {
      const vp = { width: W, height: H };
      const max = bottomLeftMaxWidth(vp);
      expect(10 + max).toBeLessThanOrEqual(zoneRect(HS_ZONES.hand, vp).left);
      expect(max).toBeGreaterThan(160);
    }
  });
});
