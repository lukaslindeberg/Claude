import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_EXPORT_MATCHES,
  exportFileName,
  pickExportDir,
  readTail,
  selectGameLogs,
  writeDiagnosticsZip,
} from '../../src/main/diagnostics/export';
import { describeSim, diffSettings, logLineAgeMs } from '../../src/main/diagnostics/describe';
import { overlayVisibility } from '../../src/main/overlayPolicy';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { match, sim } from './fixtures';
import { unzip } from './unzip';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-export-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function session(logsDir: string, name: string, content: string | Buffer) {
  mkdirSync(join(logsDir, name), { recursive: true });
  writeFileSync(join(logsDir, name, 'Power.log'), content);
}

describe('export helpers', () => {
  it('names the zip after the local time and avoids collisions', () => {
    const now = new Date(2026, 10, 7, 9, 5);
    expect(exportFileName(now, dir)).toBe('TavernLens-diagnostics-20261107-0905.zip');
    writeFileSync(join(dir, 'TavernLens-diagnostics-20261107-0905.zip'), '');
    expect(exportFileName(now, dir)).toBe('TavernLens-diagnostics-20261107-0905-2.zip');
  });

  it('picks the first writable folder (Desktop, then Downloads, then userData)', () => {
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, '');
    expect(pickExportDir([undefined, file, join(dir, 'Downloads')])).toBe(join(dir, 'Downloads'));
  });

  it('selects the newest session log and the previous one only if small', () => {
    const logs = join(dir, 'Logs');
    session(logs, 'Hearthstone_2026_11_06_20_00_00', 'old');
    session(logs, 'Hearthstone_2026_11_07_10_00_00', 'previous');
    session(logs, 'Hearthstone_2026_11_07_18_30_00', 'newest');
    mkdirSync(join(logs, 'Hearthstone_2026_11_07_19_00_00')); // no Power.log yet
    mkdirSync(join(logs, 'unrelated'));
    expect(selectGameLogs(logs).map((g) => g.session)).toEqual(['Hearthstone_2026_11_07_18_30_00', 'Hearthstone_2026_11_07_10_00_00']);
    expect(selectGameLogs(logs, 3).map((g) => g.session)).toEqual(['Hearthstone_2026_11_07_18_30_00']);
    const legacy = join(dir, 'LegacyLogs');
    mkdirSync(legacy);
    writeFileSync(join(legacy, 'Power.log'), 'x');
    expect(selectGameLogs(legacy)).toEqual([{ path: join(legacy, 'Power.log'), size: 1 }]);
    expect(selectGameLogs(join(dir, 'missing'))).toEqual([]);
  });

  it('keeps the tail of a large file from a line boundary', async () => {
    const f = join(dir, 'big.log');
    writeFileSync(f, Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n');
    const all = await readTail(f, 1 << 20);
    expect(all.truncated).toBe(false);
    const t = await readTail(f, 50);
    expect(t.truncated).toBe(true);
    expect(t.size).toBe(all.size);
    const text = t.data.toString();
    expect(text.startsWith('line ')).toBe(true);
    expect(text.endsWith('line 99\n')).toBe(true);
    expect(t.data.length).toBeLessThanOrEqual(50);
  });
});

describe('writeDiagnosticsZip', () => {
  it('writes every part, readable by a strict unzip', async () => {
    const appLogs = join(dir, 'userData', 'logs');
    mkdirSync(appLogs, { recursive: true });
    writeFileSync(join(appLogs, 'tavern-lens.log'), '2026-11-07T10:00:00.000+01:00 INFO  [app] newest\n');
    writeFileSync(join(appLogs, 'tavern-lens.1.log'), '2026-11-07T09:00:00.000+01:00 INFO  [app] older\n');
    writeFileSync(join(appLogs, 'other.log'), 'not exported');
    const hsLogs = join(dir, 'Hearthstone', 'Logs');
    const power = 'D 10:00:00.0000000 GameState.DebugPrintPower() - CREATE_GAME\n'.repeat(1000);
    session(hsLogs, 'Hearthstone_2026_11_07_10_00_00', power);
    session(hsLogs, 'Hearthstone_2026_11_06_10_00_00', 'previous session\n');
    const cfg = join(dir, 'log.config');
    writeFileSync(cfg, '[Power]\nLogLevel=1\n');
    const out = join(dir, 'Desktop');
    mkdirSync(out);
    const history = Array.from({ length: 40 }, (_, i) => match({ id: `m${i}`, combats: [{ turn: 1, opponentPlayerId: 2, opponentHeroCardId: 'H', result: 'won', damage: 3, prediction: sim(60) }] }));

    const res = await writeDiagnosticsZip({
      outDir: out,
      now: new Date(2026, 10, 7, 21, 4),
      appVersion: '1.0.0',
      appLogsDir: appLogs,
      simCases: '{"key":"g:1"}\n',
      settings: { ...DEFAULT_SETTINGS, verboseLogging: true },
      history,
      status: { version: '1.0.0', logConfig: 'ok' },
      system: { os: { platform: 'win32' } },
      includeGameLogs: true,
      game: { logsDir: hsLogs, logConfigPath: cfg },
    });
    expect(res.path).toBe(join(out, 'TavernLens-diagnostics-20261107-2104.zip'));
    const zip = unzip(readFileSync(res.path));
    expect(res.bytes).toBe(readFileSync(res.path).length);
    expect([...zip.keys()].sort()).toEqual(
      [
        'README.txt',
        'hearthstone/Hearthstone_2026_11_06_10_00_00/Power.log.gz',
        'hearthstone/Hearthstone_2026_11_07_10_00_00/Power.log.gz',
        'hearthstone/log.config',
        'history.json',
        'logs/sim-cases.jsonl',
        'logs/tavern-lens.1.log',
        'logs/tavern-lens.log',
        'manifest.json',
        'settings.json',
        'status.json',
        'system.json',
      ].sort(),
    );
    const text = (n: string) => zip.get(n)!.data.toString('utf8');
    expect(text('README.txt')).toContain('sim-cases.jsonl');
    expect(text('logs/tavern-lens.log')).toContain('newest');
    expect(text('logs/sim-cases.jsonl')).toBe('{"key":"g:1"}\n');
    expect(JSON.parse(text('settings.json')).verboseLogging).toBe(true);
    const hist = JSON.parse(text('history.json'));
    expect(hist).toHaveLength(HISTORY_EXPORT_MATCHES);
    expect(hist[0].id).toBe('m0');
    expect(hist[0].combats[0].prediction.win).toBe(60);
    expect(JSON.parse(text('status.json')).logConfig).toBe('ok');
    expect(JSON.parse(text('system.json')).os.platform).toBe('win32');
    const gz = zip.get('hearthstone/Hearthstone_2026_11_07_10_00_00/Power.log.gz')!;
    expect(gz.method).toBe(0);
    expect(gunzipSync(gz.data).toString()).toBe(power);
    expect(text('hearthstone/log.config')).toContain('[Power]');
    const manifest = JSON.parse(text('manifest.json'));
    expect(manifest.gameLogs.map((g: { session: string; included: boolean }) => [g.session, g.included])).toEqual([
      ['Hearthstone_2026_11_07_10_00_00', true],
      ['Hearthstone_2026_11_06_10_00_00', true],
    ]);
    expect(manifest.historyMatches).toBe(30);
    expect(manifest.files.length).toBe(11);
  });

  it('leaves out game logs when asked and notes why', async () => {
    const appLogs = join(dir, 'logs');
    mkdirSync(appLogs);
    const res = await writeDiagnosticsZip({
      outDir: dir,
      now: new Date(),
      appVersion: '1.0.0',
      appLogsDir: appLogs,
      simCases: '',
      settings: {},
      history: [],
      status: {},
      system: {},
      includeGameLogs: false,
      game: { logsDir: join(dir, 'whatever') },
    });
    const zip = unzip(readFileSync(res.path));
    expect([...zip.keys()].some((k) => k.startsWith('hearthstone/'))).toBe(false);
    expect(res.notes).toContain('Hearthstone game logs not included (option unchecked)');
    expect(res.notes.some((n) => n.startsWith('no tavern-lens*.log files'))).toBe(true);
  });
});

describe('diagnostic descriptions', () => {
  it('diffs settings by key, one level deep, positions summarised', () => {
    const prev = { ...DEFAULT_SETTINGS, positions: { tierList: { x: 0.1, y: 0.2 } } };
    const next = {
      ...prev,
      overlayEnabled: false,
      widgets: { ...prev.widgets, tierList: false },
      positions: { tierList: { x: 0.3, y: 0.2 }, battleSim: { x: 0.5, y: 0.5 } },
      hearthstonePath: 'D:\\Games\\Hearthstone',
    };
    expect(diffSettings(prev, next)).toEqual([
      'overlayEnabled: true -> false',
      'widgets.tierList: true -> false',
      'positions: moved tierList, battleSim',
      'hearthstonePath: (unset) -> "D:\\\\Games\\\\Hearthstone"',
    ]);
    expect(diffSettings(next, { ...next, positions: {} })).toEqual(['positions: reset']);
    expect(diffSettings(prev, prev)).toEqual([]);
  });

  it('explains overlay visibility', () => {
    const base = {
      overlayEnabled: true,
      hideWhenUnfocused: true,
      demoRunning: false,
      window: { found: true, focused: true, minimized: false },
      trackerSupported: true,
      gameActive: false,
    };
    expect(overlayVisibility(base)).toEqual({ visible: true, reason: 'Hearthstone focused' });
    expect(overlayVisibility({ ...base, window: { found: true, focused: false, minimized: false } }).reason).toBe('Hearthstone not focused (hide when unfocused)');
    expect(overlayVisibility({ ...base, window: { found: false, focused: false, minimized: false } }).reason).toBe('Hearthstone window not found');
    expect(overlayVisibility({ ...base, overlayEnabled: false }).visible).toBe(false);
    expect(overlayVisibility({ ...base, trackerSupported: false, gameActive: true }).visible).toBe(true);
  });

  it('describes a simulation and the age of a log line', () => {
    expect(describeSim({ ...sim(62.14), unsupported: ['BG_X'] })).toBe(
      'win 62.1% tie 0.0% loss 37.9% · dmg +5.0/-4.0 · lethal 0.0%/0.0% · 1000 it in 10 ms · unsupported: BG_X',
    );
    const now = new Date(2026, 10, 7, 0, 0, 5);
    expect(logLineAgeMs('23:59:58.5000000', now)).toBeCloseTo(6500, 0);
    expect(Number.isNaN(logLineAgeMs('', now))).toBe(true);
  });
});
