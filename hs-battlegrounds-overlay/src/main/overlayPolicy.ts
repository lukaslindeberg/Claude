/**
 * Pure decisions about the overlay window: visibility and bounds. No Electron imports.
 */
import type { GameWindowInfo } from '@shared/types';
import type { Rect } from './hearthstone/windowTracker';

export interface OverlayVisibilityInput {
  overlayEnabled: boolean;
  hideWhenUnfocused: boolean;
  demoRunning: boolean;
  window: GameWindowInfo;
  /** Whether this platform can locate the game window. */
  trackerSupported: boolean;
  /** A live Battlegrounds game is in progress. */
  gameActive: boolean;
}

export function shouldShowOverlay(p: OverlayVisibilityInput): boolean {
  if (!p.overlayEnabled) return false;
  if (p.demoRunning) return true;
  if (!p.trackerSupported) return p.gameActive;
  if (!p.window.found || p.window.minimized) return false;
  if (p.hideWhenUnfocused && !p.window.focused) return false;
  return true;
}

export function overlayBounds(p: { demoRunning: boolean; window: GameWindowInfo; fallback: Rect }): Rect {
  if (p.demoRunning || !p.window.bounds) return p.fallback;
  const b = p.window.bounds;
  if (b.width < 50 || b.height < 50) return p.fallback;
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}
