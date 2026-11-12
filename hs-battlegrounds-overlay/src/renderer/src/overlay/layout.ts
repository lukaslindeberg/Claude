import type { Viewport } from '../hooks/useViewport';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Horizontal centres of the offered heroes on the in-game hero picker (fraction of width). */
export function heroPickCenters(count: number, vp: Viewport): number[] {
  // The picker spreads heroes across the board, which is ~4:3 centred in the window.
  const boardWidth = Math.min(vp.width, vp.height * 1.5);
  const spacing = boardWidth * (count <= 2 ? 0.26 : 0.205);
  const mid = vp.width / 2;
  return Array.from({ length: count }, (_, i) => mid + (i - (count - 1) / 2) * spacing);
}

/** Top of the game's hero portraits on the hero picker (fraction of height): stat cards end above. */
export const HERO_PICK_ART_TOP = 0.315;

/** Unscaled widths of the pick cards (CSS px at scale 1). */
export const PICK_CARD_WIDTH = { hero: 310, trinket: 280 };

/**
 * Trinket offers (lesser / greater) are dealt like a Discover: a row of cards across the
 * middle of the screen. Our stat cards sit above that row, centred over each card, and
 * keep clear of the leaderboard panel (top-right).
 */
export function trinketPickLayout(count: number, vp: Viewport, s: number): { centers: number[]; spacing: number; top: number; bottom: number } {
  const H = vp.height;
  const n = Math.max(1, count);
  const side = 2 * (10 + WIDGET_WIDTH.oppPanel * s * 0.95);
  const spacing = Math.min(H * (n <= 3 ? 0.31 : 0.27), (vp.width - side) / n);
  const mid = vp.width / 2;
  return {
    centers: Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * spacing),
    spacing,
    top: Math.round(H * 0.03),
    /** The game's trinket cards start a little below this. */
    bottom: Math.round(H * 0.285),
  };
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

/** Space kept free at the bottom of the right-edge panels (menu gear). */
export function bottomReserve(vp: Viewport): number {
  return Math.round(vp.height * 0.08);
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/** Unscaled widths (CSS px at scale 1) of the widgets the layout is computed around. */
export const WIDGET_WIDTH = { oppPanel: 302, sim: 268 };
const EDGE = 10;

export interface SimPlacement {
  /** Right edge of the plaque in window px. */
  right: number;
  top: number;
  /** Zoom for the plaque (≤ the overlay scale; smaller only when it would not fit). */
  scale: number;
}

/**
 * Default spot of the battle plaque: the top-left area, right-aligned against the game's
 * own controls. Combat: just left of the opponent's portrait. Shop ("last battle"): just
 * left of Bob's tier-up button. It shrinks instead of covering them in narrow windows.
 */
export function battleSimPlacement(view: 'combat' | 'last', vp: Viewport, s: number): SimPlacement {
  const H = vp.height;
  const zone = view === 'combat' ? HS_ZONES.oppHero : HS_ZONES.bob;
  const right = vp.width / 2 + zone.x0 * H - 8;
  const avail = right - EDGE;
  return { right, top: Math.round(H * 0.012), scale: Math.min(s, Math.max(0.6, avail / WIDGET_WIDTH.sim)) };
}

/** Widest a bottom-left widget may be (window px) without reaching into the hand. */
export function bottomLeftMaxWidth(vp: Viewport): number {
  return Math.max(200, vp.width / 2 + HS_ZONES.hand.x0 * vp.height - 2 * EDGE);
}
