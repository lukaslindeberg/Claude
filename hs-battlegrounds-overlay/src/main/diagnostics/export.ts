/**
 * "Export diagnostics": one zip with everything the developer needs to understand a
 * session after the fact. No Electron imports (paths and data are passed in).
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { logFilesIn } from '../logger';
import { POWER_LOG_FILE, sessionFolderKey } from '../hearthstone/paths';
import { ZipWriter } from './zip';

const gzipAsync = promisify(gzip);

/** Cap per Power.log (uncompressed); a larger log keeps its tail. */
export const GAME_LOG_MAX_BYTES = 60 * 1024 * 1024;
/** The previous client session's Power.log is included when at most this big. */
export const PREVIOUS_GAME_LOG_MAX_BYTES = 25 * 1024 * 1024;
export const HISTORY_EXPORT_MATCHES = 30;

export interface ExportGameLogsInput {
  /** `<install>/Logs`. */
  logsDir?: string;
  /** Hearthstone's log.config (small, tells whether Power.log logging is configured). */
  logConfigPath?: string;
}

export interface DiagnosticsExportInput {
  outDir: string;
  now: Date;
  appVersion: string;
  /** Folder with tavern-lens*.log. */
  appLogsDir: string;
  /** Merged sim-cases.jsonl text. */
  simCases: string;
  settings: unknown;
  /** Newest first; trimmed to the last HISTORY_EXPORT_MATCHES. */
  history: unknown[];
  status: unknown;
  system: unknown;
  includeGameLogs: boolean;
  game: ExportGameLogsInput;
}

export interface DiagnosticsExportOutput {
  path: string;
  bytes: number;
  files: { name: string; size: number }[];
  notes: string[];
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `TavernLens-diagnostics-YYYYMMDD-HHMM.zip` (local time), with `-2`, `-3`... if taken. */
export function exportFileName(now: Date, dir: string): string {
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  const base = `TavernLens-diagnostics-${stamp}`;
  for (let i = 1; i < 100; i++) {
    const name = `${base}${i > 1 ? `-${i}` : ''}.zip`;
    if (!existsSync(join(dir, name))) return name;
  }
  return `${base}-${Date.now()}.zip`;
}

/** First candidate directory that exists (or can be created) and is writable. */
export function pickExportDir(candidates: Array<string | undefined>): string | undefined {
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!statSync(dir).isDirectory()) continue;
      accessSync(dir, constants.W_OK);
      return dir;
    } catch {
      /* next */
    }
  }
  return undefined;
}

export interface GameLogFile {
  path: string;
  /** Session folder (`Hearthstone_YYYY_MM_DD_HH_MM_SS`) or undefined for the legacy layout. */
  session?: string;
  size: number;
}

/** The newest client session's Power.log, plus the previous one if it is small. */
export function selectGameLogs(logsDir: string, previousMaxBytes = PREVIOUS_GAME_LOG_MAX_BYTES): GameLogFile[] {
  let names: string[];
  try {
    names = readdirSync(logsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && sessionFolderKey(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const withLogs: GameLogFile[] = [];
  for (const name of names.sort((a, b) => (sessionFolderKey(b)! > sessionFolderKey(a)! ? 1 : -1))) {
    const path = join(logsDir, name, POWER_LOG_FILE);
    try {
      const st = statSync(path);
      if (st.isFile()) withLogs.push({ path, session: name, size: st.size });
    } catch {
      /* folder without a Power.log (Hearthstone not started a game yet) */
    }
    if (withLogs.length >= 2) break;
  }
  if (!withLogs.length) {
    // Very old clients: <Logs>/Power.log directly.
    const legacy = join(logsDir, POWER_LOG_FILE);
    try {
      const st = statSync(legacy);
      if (st.isFile()) return [{ path: legacy, size: st.size }];
    } catch {
      return [];
    }
    return [];
  }
  const out = [withLogs[0]];
  if (withLogs[1] && withLogs[1].size <= previousMaxBytes) out.push(withLogs[1]);
  return out;
}

/** Reads a file, or its last `maxBytes` starting at a line boundary. */
export async function readTail(path: string, maxBytes: number): Promise<{ data: Buffer; size: number; truncated: boolean }> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const { bytesRead } = await fh.read(buf, read, len - read, start + read);
      if (bytesRead <= 0) break;
      read += bytesRead;
    }
    let data = buf.subarray(0, read);
    if (start > 0) {
      const nl = data.indexOf(0x0a);
      if (nl >= 0) data = data.subarray(nl + 1);
    }
    return { data, size, truncated: start > 0 };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

export const README = `Tavern Lens diagnostics
=======================

This archive was exported from Tavern Lens (Settings > About > Diagnostics) so the
developer can see what happened while the overlay was used. Nothing in it was
uploaded anywhere: whoever has this file can read it.

Privacy: the logs, history and Hearthstone game logs contain the player's BattleTag
and the names of opponents, as Hearthstone writes them to its own log files.

Contents
--------
manifest.json          What was exported, when, file sizes, and notes (truncation,
                       missing files).
logs/tavern-lens.log   The app log, newest file first: tavern-lens.log, then
logs/tavern-lens.N.log tavern-lens.1.log ... (rotated at ~5 MB, 5 files kept).
                       Format: "<local ISO time> <LEVEL> [scope] message {json}";
                       indented lines continue the previous entry (stacks, headers).
                       Each app start writes a session header (versions, OS,
                       displays and DPI scaling, Hearthstone paths, log.config,
                       card data, settings).
                       Useful scopes: [app] window tracking, overlay show/hide with
                       the reason, hotkeys, settings changes; [live] tracker events
                       (game start, heroes, turns, combats, game end) and phase
                       changes with how far behind the clock the log line was;
                       [tailer] Power.log selection; [sim] simulator runs and
                       whether they matched the real result; [renderer:*] errors
                       from the overlay / companion windows (incl. React widget
                       crashes with component stacks) and the simulator worker.
logs/sim-cases.jsonl   One JSON object per combat (last ~400): app version, card
                       data build, game id + turn, the full BattleSimInput, the
                       BattleSimResult, the actual outcome and a verdict (matched,
                       chance the sim gave the actual outcome, "surprise" when it
                       was below 5%). Replay a case with simulateBattle(case.input)
                       from src/core/sim to reproduce a simulator mistake.
settings.json          The app settings.
history.json           The last 30 saved matches (newest first), with the
                       simulator prediction stored on each combat.
status.json            App status at export time (paths, log.config state, game
                       window, card data, user-facing errors, error counters).
system.json            App/Electron/Chrome/Node versions, OS, CPU, memory,
                       displays (bounds, work area, scale factor), GPU features.
hearthstone/log.config Hearthstone's logging configuration (if found).
hearthstone/<session>/Power.log.gz
                       Hearthstone's own game log of the newest client session
                       (and the previous one if small), gzipped, at most 60 MB
                       uncompressed each (the tail is kept if larger). Only present
                       when "Include Hearthstone game logs" was checked. Feed it to
                       BgTracker (src/core/bg) to replay the games exactly.
`;

/** Builds the zip. Throws on failure (the partial file is removed). */
export async function writeDiagnosticsZip(input: DiagnosticsExportInput): Promise<DiagnosticsExportOutput> {
  const path = join(input.outDir, exportFileName(input.now, input.outDir));
  const zip = new ZipWriter(path);
  const notes: string[] = [];
  const mtime = input.now;
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  try {
    zip.add('README.txt', README.replace(/\n/g, '\r\n'), { mtime });

    // App logs
    const logs = logFilesIn(input.appLogsDir);
    if (!logs.length) notes.push(`no tavern-lens*.log files in ${input.appLogsDir}`);
    for (const f of logs) {
      try {
        await zip.addAsync(`logs/${basename(f)}`, readFileSync(f), { mtime: statSync(f).mtime });
      } catch (err) {
        notes.push(`could not read ${f}: ${(err as Error)?.message ?? err}`);
      }
    }
    await zip.addAsync('logs/sim-cases.jsonl', input.simCases, { mtime });

    zip.add('settings.json', json(input.settings), { mtime });
    const history = input.history.slice(0, HISTORY_EXPORT_MATCHES);
    await zip.addAsync('history.json', json(history), { mtime });
    zip.add('status.json', json(input.status), { mtime });
    zip.add('system.json', json(input.system), { mtime });

    // Hearthstone
    const cfg = input.game.logConfigPath;
    if (cfg) {
      try {
        zip.add('hearthstone/log.config', readFileSync(cfg), { mtime: statSync(cfg).mtime });
      } catch {
        notes.push(`log.config not found at ${cfg}`);
      }
    }
    const gameLogs: Array<GameLogFile & { included: boolean; truncated?: boolean; keptBytes?: number }> = [];
    if (!input.includeGameLogs) notes.push('Hearthstone game logs not included (option unchecked)');
    else if (!input.game.logsDir) notes.push('Hearthstone Logs folder unknown (installation not found)');
    else {
      const selected = selectGameLogs(input.game.logsDir);
      if (!selected.length) notes.push(`no Power.log found under ${input.game.logsDir}`);
      for (const g of selected) {
        try {
          const { data, size, truncated } = await readTail(g.path, GAME_LOG_MAX_BYTES);
          const gz = await gzipAsync(data, { level: 6 });
          const name = `hearthstone/${g.session ? `${g.session}/` : ''}Power.log.gz`;
          await zip.addAsync(name, gz, { store: true, mtime: statSync(g.path).mtime });
          gameLogs.push({ ...g, size, included: true, truncated, keptBytes: data.length });
          if (truncated) notes.push(`${name}: kept the last ${data.length} of ${size} bytes`);
        } catch (err) {
          gameLogs.push({ ...g, included: false });
          notes.push(`could not read ${g.path}: ${(err as Error)?.message ?? err}`);
        }
      }
    }

    const manifest = {
      app: 'Tavern Lens',
      appVersion: input.appVersion,
      exportedAt: input.now.toISOString(),
      exportedAtLocal: input.now.toString(),
      timezoneOffsetMinutes: -input.now.getTimezoneOffset(),
      includeGameLogs: input.includeGameLogs,
      historyMatches: history.length,
      gameLogs,
      notes,
      files: zip.entryList,
    };
    zip.add('manifest.json', json(manifest), { mtime });
    const bytes = zip.close();
    return { path, bytes, files: zip.entryList.map((e) => ({ name: e.name, size: e.size })), notes };
  } catch (err) {
    zip.abort();
    throw err;
  }
}
