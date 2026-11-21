/**
 * Hearthstone's log.config: makes sure the client writes Power.log.
 *
 * Pure string transform (`ensurePowerLogConfig`) + a thin fs wrapper
 * (`ensureLogConfigFile`). No Electron imports.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppStatus } from '@shared/types';

/** Settings required in the `[Power]` section, in the order they are written. */
export const REQUIRED_POWER_SETTINGS: ReadonlyArray<readonly [string, string]> = [
  ['LogLevel', '1'],
  ['FilePrinting', 'true'],
  ['ConsolePrinting', 'false'],
  ['ScreenPrinting', 'false'],
  ['Verbose', 'true'],
];

export function logConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(local, 'Blizzard', 'Hearthstone', 'log.config');
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Preferences', 'Blizzard', 'Hearthstone', 'log.config');
  return undefined;
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
const KV_RE = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/;

function sameValue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Ensures a `[Power]` section with the required settings exists. All other
 * sections, comments and lines are preserved verbatim, as is the line ending style.
 */
export function ensurePowerLogConfig(content: string): { content: string; changed: boolean } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.length ? content.split(/\r?\n/) : [];
  // A trailing newline produces a final empty element; remember it to restore later.
  const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (hadTrailingNewline) lines.pop();

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i]);
    if (m && m[1].trim().toLowerCase() === 'power') {
      start = i;
      break;
    }
  }

  let changed = false;
  if (start < 0) {
    // Append a fresh section, separated by a blank line from existing content.
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('[Power]');
    for (const [k, v] of REQUIRED_POWER_SETTINGS) lines.push(`${k}=${v}`);
    changed = true;
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (SECTION_RE.test(lines[i])) {
        end = i;
        break;
      }
    }
    const missing: string[] = [];
    for (const [key, value] of REQUIRED_POWER_SETTINGS) {
      let found = false;
      for (let i = start + 1; i < end; i++) {
        const m = KV_RE.exec(lines[i]);
        if (!m || m[1].toLowerCase() !== key.toLowerCase()) continue;
        if (found) {
          // Duplicate key: drop it so the client can't pick the wrong one.
          lines.splice(i, 1);
          end--;
          i--;
          changed = true;
          continue;
        }
        found = true;
        if (!sameValue(m[2], value)) {
          lines[i] = `${key}=${value}`;
          changed = true;
        }
      }
      if (!found) missing.push(`${key}=${value}`);
    }
    if (missing.length) {
      // Insert after the section's last non-blank line.
      let insertAt = end;
      while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt--;
      lines.splice(insertAt, 0, ...missing);
      changed = true;
    }
  }
  if (!changed) return { content, changed: false };
  return { content: lines.join(eol) + eol, changed: true };
}

/**
 * Creates/patches log.config on disk. Returns:
 *  - 'ok'        file already correct
 *  - 'updated'   file existed and was patched (restart Hearthstone if it is running)
 *  - 'missing-restart-required' file did not exist and was created
 *  - 'unknown'   platform without a known location
 *  - 'error'     could not read/write
 */
export function ensureLogConfigFile(path: string | undefined = logConfigPath()): AppStatus['logConfig'] {
  if (!path) return 'unknown';
  try {
    const existed = existsSync(path);
    const before = existed ? readFileSync(path, 'utf8') : '';
    const { content, changed } = ensurePowerLogConfig(before);
    if (!changed) return 'ok';
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tl-tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
    return existed ? 'updated' : 'missing-restart-required';
  } catch {
    return 'error';
  }
}
