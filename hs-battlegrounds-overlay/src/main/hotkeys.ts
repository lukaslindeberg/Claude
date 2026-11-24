/**
 * Global shortcuts from `settings.hotkeys`.
 */
import { globalShortcut } from 'electron';
import type { Settings } from '@shared/types';
import { createLogger } from './logger';

const log = createLogger('hotkeys');

export type HotkeyAction = keyof Settings['hotkeys'];

/**
 * (Re-)registers the hotkeys. Returns human-readable errors for accelerators that
 * could not be registered (invalid or taken by another app).
 */
export function registerHotkeys(
  hotkeys: Settings['hotkeys'],
  handler: (action: HotkeyAction) => void,
): string[] {
  globalShortcut.unregisterAll();
  const errors: string[] = [];
  for (const [action, accel] of Object.entries(hotkeys) as [HotkeyAction, string][]) {
    if (!accel || !accel.trim()) continue;
    try {
      const ok = globalShortcut.register(accel, () => handler(action));
      if (!ok) errors.push(`Hotkey ${accel} (${action}) is already in use by another application`);
    } catch (err) {
      errors.push(`Invalid hotkey "${accel}" for ${action}`);
      log.warn(`invalid accelerator ${accel}`, err);
    }
  }
  if (errors.length) log.warn(errors.join('; '));
  return errors;
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
