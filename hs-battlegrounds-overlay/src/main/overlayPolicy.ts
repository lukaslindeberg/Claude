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
  return overlayVisibility(p).visible;
}

/** The visibility decision with a short reason (for the diagnostics log). */
export function overlayVisibility(p: OverlayVisibilityInput): { visible: boolean; reason: string } {
  if (!p.overlayEnabled) return { visible: false, reason: 'overlay disabled' };
  if (p.demoRunning) return { visible: true, reason: 'demo running' };
  if (!p.trackerSupported) {
    return p.gameActive
      ? { visible: true, reason: 'game active (window tracking unsupported on this platform)' }
      : { visible: false, reason: 'no game active (window tracking unsupported on this platform)' };
  }
  if (!p.window.found) return { visible: false, reason: 'Hearthstone window not found' };
  if (p.window.minimized) return { visible: false, reason: 'Hearthstone minimized' };
  if (p.hideWhenUnfocused && !p.window.focused) return { visible: false, reason: 'Hearthstone not focused (hide when unfocused)' };
  return { visible: true, reason: p.window.focused ? 'Hearthstone focused' : 'Hearthstone visible (shown while unfocused)' };
}

export function overlayBounds(p: { demoRunning: boolean; window: GameWindowInfo; fallback: Rect }): Rect {
  if (p.demoRunning || !p.window.bounds) return p.fallback;
  const b = p.window.bounds;
  if (b.width < 50 || b.height < 50) return p.fallback;
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}
