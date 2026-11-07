import type { Settings } from '@shared/types';
import type { Viewport } from '../hooks/useViewport';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Leaderboard slot rectangles in window pixels. Calibration units are
 * fractions of the game window height; `left` is relative to the horizontal
 * centre (the in-game leaderboard scales with height and is anchored to the
 * centre of the board for wide aspect ratios).
 */
export function leaderboardSlots(cal: Settings['leaderboardCalibration'], vp: Viewport, count: number): Rect[] {
  const H = vp.height;
  const left = vp.width / 2 + cal.left * H;
  const width = cal.width * H;
  const height = cal.slotHeight * H;
  return Array.from({ length: count }, (_, i) => ({
    left,
    top: (cal.top + i * (cal.slotHeight + cal.gap)) * H,
    width,
    height,
  }));
}

/** Horizontal centres of the offered heroes on the in-game hero picker (fraction of width). */
export function heroPickCenters(count: number, vp: Viewport): number[] {
  // The picker spreads heroes across the board, which is ~4:3 centred in the window.
  const boardWidth = Math.min(vp.width, vp.height * 1.5);
  const spacing = boardWidth * (count <= 2 ? 0.26 : 0.205);
  const mid = vp.width / 2;
  return Array.from({ length: count }, (_, i) => mid + (i - (count - 1) / 2) * spacing);
}

/** Automatic scale: settings.scale × game-window height relative to 1080p. */
export function effectiveScale(settingsScale: number, vp: Viewport): number {
  const auto = Math.max(0.7, Math.min(2.2, vp.height / 1080));
  return Math.max(0.4, (settingsScale || 1) * auto);
}

// ---------------------------------------------------------------------------
// Hearthstone's own controls: default widget positions keep clear of them.
// ---------------------------------------------------------------------------

/** A box in game-height units: x relative to the window centre, y from the top. */
export interface Zone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Where Hearthstone draws its clickable UI (estimates with a margin; the board scales
 * with the window height and stays centred, pillarboxed beyond 16:9).
 */
export const HS_ZONES = {
  /** Recruit: Bob with the tier-up button (left), refresh and freeze (right). */
  bob: { x0: -0.24, x1: 0.26, y0: 0, y1: 0.25 },
  /** Combat: the opponent's portrait and hero power. */
  oppHero: { x0: -0.085, x1: 0.2, y0: 0.04, y1: 0.3 },
  /** Your portrait, hero power (right of it), trinkets and quest. */
  hero: { x0: -0.2, x1: 0.22, y0: 0.7, y1: 0.95 },
  /** Your hand along the bottom edge. */
  hand: { x0: -0.36, x1: 0.34, y0: 0.86, y1: 1 },
  /** Duos: teammate portal / pass area on the right. */
  duosPortal: { x0: 0.56, x1: 0.8, y0: 0.33, y1: 0.62 },
} satisfies Record<string, Zone>;

export function zoneRect(z: Zone, vp: Viewport): Rect {
  const H = vp.height;
  return { left: vp.width / 2 + z.x0 * H, top: z.y0 * H, width: (z.x1 - z.x0) * H, height: (z.y1 - z.y0) * H };
}

/** The 16:9 area Hearthstone draws in (narrower windows use their full width). */
export function gameArea(vp: Viewport): { left: number; right: number } {
  const w = Math.min(vp.width, (vp.height * 16) / 9);
  return { left: (vp.width - w) / 2, right: (vp.width + w) / 2 };
}

/** The options menu gear in the bottom-right corner of the game area. */
export function gearRect(vp: Viewport): Rect {
  const s = vp.height * 0.075;
  return { left: gameArea(vp).right - s, top: vp.height - s, width: s, height: s };
}

/** Space kept free at the bottom of the right-edge panels (menu gear). */
export function bottomReserve(vp: Viewport): number {
  return Math.round(vp.height * 0.08);
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/** Unscaled widths (CSS px at scale 1) of the widgets the battle plaque is placed around. */
export const WIDGET_WIDTH = { tierBar: 290, oppPanel: 302, sim: 414, simCompact: 336, simFolded: 205 };
const EDGE = 10;

/** Right edge of the widgets docked in the top-left corner (the tier bar). */
function topLeftEdge(s: number, tierBar: boolean): number {
  return tierBar ? EDGE + WIDGET_WIDTH.tierBar * s + EDGE : EDGE;
}

export interface SimPlacement {
  /** Right edge of the plaque in window px. */
  right: number;
  top: number;
  /** Zoom for the plaque (≤ the overlay scale; smaller only when it would not fit). */
  scale: number;
  /** Zoom for the folded badge. */
  foldedScale: number;
  /** Fold to the badge by default (the plaque does not fit). */
  fold: boolean;
}

/**
 * Default spot of the battle plaque. Combat: top centre, just left of the opponent's
 * portrait and right of the tier bar. Shop ("last battle"): top right, between Bob's
 * freeze button and the leaderboard panel. When the space is too narrow at this
 * scale/aspect ratio, the plaque shrinks (and in the shop folds) instead of covering
 * the game's buttons.
 */
export function battleSimPlacement(view: 'combat' | 'last', vp: Viewport, s: number, opts: { tierBar: boolean; oppPanel: boolean }): SimPlacement {
  const H = vp.height;
  const top = Math.round(H * 0.012);
  if (view === 'combat') {
    const right = vp.width / 2 + HS_ZONES.oppHero.x0 * H - 8;
    const avail = right - topLeftEdge(s, opts.tierBar);
    return { right, top, scale: Math.min(s, Math.max(0.75, avail / WIDGET_WIDTH.sim)), foldedScale: s, fold: false };
  }
  const right = vp.width - (opts.oppPanel ? 6 + WIDGET_WIDTH.oppPanel * s + 12 : EDGE);
  const avail = right - (vp.width / 2 + HS_ZONES.bob.x1 * H + 8);
  const fit = avail / WIDGET_WIDTH.simCompact;
  const foldedScale = Math.min(s, Math.max(0.7, avail / WIDGET_WIDTH.simFolded));
  return { right, top, scale: Math.min(s, Math.max(0.75, fit)), foldedScale, fold: fit < Math.min(s, 0.85) };
}

/** Widest a bottom-left widget may be (window px) without reaching into the hand. */
export function bottomLeftMaxWidth(vp: Viewport): number {
  return Math.max(200, vp.width / 2 + HS_ZONES.hand.x0 * vp.height - 2 * EDGE);
}
