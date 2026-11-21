/**
 * Hearthstone install / log discovery. No Electron imports (testable).
 *
 * Log layout (since 2020): `<install>/Logs/Hearthstone_YYYY_MM_DD_HH_MM_SS/Power.log`,
 * one folder per client launch. We always tail the newest folder and switch when a
 * newer one appears. Very old clients wrote `<install>/Logs/Power.log` directly.
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const POWER_LOG_FILE = 'Power.log';
const SESSION_DIR_RE = /^Hearthstone_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/;

/** Uninstall registry keys Battle.net writes for Hearthstone. */
export const HEARTHSTONE_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hearthstone',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hearthstone',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hearthstone',
];

/** Parses `reg query <key> /v InstallLocation` output. */
export function parseRegQueryInstallLocation(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i.exec(line);
    if (m && m[1]) return m[1].replace(/^"|"$/g, '');
  }
  return undefined;
}

function regQuery(key: string, timeoutMs = 4000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'InstallLocation'], { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve(undefined);
      resolve(parseRegQueryInstallLocation(String(stdout)));
    });
  });
}

/** A directory looks like a Hearthstone install if it has the game binary or a Logs folder. */
export function looksLikeHearthstoneInstall(dir: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  const markers =
    platform === 'darwin'
      ? ['Hearthstone.app', 'Logs']
      : platform === 'win32'
        ? ['Hearthstone.exe', 'Hearthstone_Data', 'Logs']
        : ['Hearthstone.exe', 'Hearthstone_Data', 'Hearthstone.app', 'Logs'];
  return markers.some((m) => existsSync(join(dir, m)));
}

/** Default install locations to probe, in priority order. */
export function defaultInstallCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    const out = ['C:\\Program Files (x86)\\Hearthstone', 'C:\\Program Files\\Hearthstone'];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`;
      if (letter !== 'C' && !existsSync(root)) continue;
      for (const sub of [
        'Program Files (x86)\\Hearthstone',
        'Program Files\\Hearthstone',
        'Hearthstone',
        'Games\\Hearthstone',
        'Battle.net\\Hearthstone',
        'Blizzard\\Hearthstone',
        'Program Files (x86)\\Battle.net\\Hearthstone',
      ]) {
        const p = root + sub;
        if (!out.includes(p)) out.push(p);
      }
    }
    return out;
  }
  if (platform === 'darwin') {
    return ['/Applications/Hearthstone', join(homedir(), 'Applications', 'Hearthstone')];
  }
  return [];
}

export interface DiscoveryOptions {
  /** User override from settings (checked first). */
  override?: string;
  platform?: NodeJS.Platform;
  /** Injected for tests. */
  registryLookup?: () => Promise<string[]>;
  candidates?: string[];
}

async function registryCandidates(): Promise<string[]> {
  const found: string[] = [];
  for (const key of HEARTHSTONE_REGISTRY_KEYS) {
    const v = await regQuery(key);
    if (v && !found.includes(v)) found.push(v);
  }
  return found;
}

/** Finds the Hearthstone install directory, or undefined. Never throws. */
export async function findHearthstoneInstall(opts: DiscoveryOptions = {}): Promise<string | undefined> {
  const platform = opts.platform ?? process.platform;
  const tried = new Set<string>();
  const check = (p: string | undefined): string | undefined => {
    if (!p || tried.has(p)) return undefined;
    tried.add(p);
    return looksLikeHearthstoneInstall(p, platform) ? p : undefined;
  };
  try {
    const o = check(opts.override?.trim());
    if (o) return o;
    if (platform === 'win32' || opts.registryLookup) {
      const reg = await (opts.registryLookup ?? registryCandidates)().catch(() => [] as string[]);
      for (const p of reg) {
        const hit = check(p);
        if (hit) return hit;
      }
    }
    for (const p of opts.candidates ?? defaultInstallCandidates(platform)) {
      const hit = check(p);
      if (hit) return hit;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

export function logsDirFor(installDir: string): string {
  return join(installDir, 'Logs');
}

/** Sort key (YYYYMMDDHHMMSS) of a session folder name, or undefined if it isn't one. */
export function sessionFolderKey(name: string): string | undefined {
  const m = SESSION_DIR_RE.exec(name);
  return m ? m.slice(1).join('') : undefined;
}

/** Picks the newest `Hearthstone_YYYY_MM_DD_HH_MM_SS` folder name from a directory listing. */
export function selectNewestLogFolder(names: string[]): string | undefined {
  let best: { name: string; key: string } | undefined;
  for (const name of names) {
    const key = sessionFolderKey(name);
    if (!key) continue;
    if (!best || key > best.key || (key === best.key && name > best.name)) best = { name, key };
  }
  return best?.name;
}

export interface ResolvedPowerLog {
  /** Absolute path of the Power.log to tail (may not exist yet). */
  path: string;
  /** Session folder name, or undefined for the legacy layout. */
  sessionFolder?: string;
}

/** Resolves which Power.log to tail inside a Logs directory. */
export function resolvePowerLog(logsDir: string): ResolvedPowerLog | undefined {
  let names: string[];
  try {
    names = readdirSync(logsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return undefined;
  }
  const newest = selectNewestLogFolder(names);
  if (newest) return { path: join(logsDir, newest, POWER_LOG_FILE), sessionFolder: newest };
  return { path: join(logsDir, POWER_LOG_FILE) };
}
