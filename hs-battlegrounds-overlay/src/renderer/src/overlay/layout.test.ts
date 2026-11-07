import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import { HS_ZONES, WIDGET_WIDTH, battleSimPlacement, bottomLeftMaxWidth, effectiveScale, leaderboardSlots, overlaps, zoneRect, type Rect } from './layout';

const SIZES: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [1920, 1200],
  [3440, 1440],
];
const SCALES = [0.8, 1, 1.2, 1.4];
/** Plaque heights at scale 1 (CSS px): full plaque with result + warning + actual row, compact, folded. */
const HEIGHT = { combat: 215, last: 125, folded: 30 };

function plaqueRect(view: 'combat' | 'last', W: number, H: number, s: number): Rect & { fold: boolean } {
  const p = battleSimPlacement(view, { width: W, height: H }, s, { tierBar: true, oppPanel: true });
  const zoom = p.fold ? p.foldedScale : p.scale;
  const w = (p.fold ? WIDGET_WIDTH.simFolded : view === 'combat' ? WIDGET_WIDTH.sim : WIDGET_WIDTH.simCompact) * zoom;
  const h = (p.fold ? HEIGHT.folded : HEIGHT[view]) * zoom;
  return { left: p.right - w, top: p.top, width: w, height: h, fold: p.fold };
}

describe('battle plaque placement', () => {
  for (const [W, H] of SIZES) {
    for (const scale of SCALES) {
      const vp = { width: W, height: H };
      const s = effectiveScale(scale, vp);
      const tierBar: Rect = { left: 10, top: 10, width: WIDGET_WIDTH.tierBar * s, height: 43 * s };

      it(`combat ${W}x${H} @${scale}: clear of the opponent's portrait and the tier bar`, () => {
        const r = plaqueRect('combat', W, H, s);
        expect(overlaps(r, zoneRect(HS_ZONES.oppHero, vp))).toBe(false);
        expect(overlaps(r, tierBar)).toBe(false);
        expect(r.left).toBeGreaterThanOrEqual(0);
      });

      it(`shop ${W}x${H} @${scale}: clear of Bob's buttons and the leaderboard panel`, () => {
        const r = plaqueRect('last', W, H, s);
        const panel: Rect = { left: W - 6 - WIDGET_WIDTH.oppPanel * s, top: H * 0.07, width: WIDGET_WIDTH.oppPanel * s, height: H * 0.85 };
        expect(overlaps(r, zoneRect(HS_ZONES.bob, vp))).toBe(false);
        expect(overlaps(r, panel)).toBe(false);
      });
    }
  }

  it('keeps the full size and stays unfolded at the default scale on 16:9', () => {
    for (const [W, H] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      const vp = { width: W, height: H };
      const s = effectiveScale(1, vp);
      for (const view of ['combat', 'last'] as const) {
        const p = battleSimPlacement(view, vp, s, { tierBar: true, oppPanel: true });
        expect(p.scale).toBeCloseTo(s);
        expect(p.fold).toBe(false);
      }
    }
  });
});

describe('bottom-left widgets', () => {
  it('stay left of the hand and right of nothing else', () => {
    for (const [W, H] of SIZES) {
      const vp = { width: W, height: H };
      const max = bottomLeftMaxWidth(vp);
      expect(10 + max).toBeLessThanOrEqual(zoneRect(HS_ZONES.hand, vp).left);
      expect(max).toBeGreaterThan(250);
    }
  });

  it('the leaderboard ends above the bottom-left dock', () => {
    for (const [W, H] of SIZES) {
      const slots = leaderboardSlots(DEFAULT_SETTINGS.leaderboardCalibration, { width: W, height: H }, 8);
      const last = slots[slots.length - 1];
      expect(last.top + last.height).toBeLessThan(H * 0.9);
    }
  });
});
