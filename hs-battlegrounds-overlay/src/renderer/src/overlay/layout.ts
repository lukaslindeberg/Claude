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
