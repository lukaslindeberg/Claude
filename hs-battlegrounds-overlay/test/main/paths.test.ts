import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findHearthstoneInstall,
  parseRegQueryInstallLocation,
  resolvePowerLog,
  selectNewestLogFolder,
} from '../../src/main/hearthstone/paths';

describe('selectNewestLogFolder', () => {
  it('picks the newest session folder and ignores other names', () => {
    expect(
      selectNewestLogFolder([
        'Hearthstone_2024_12_31_23_59_59',
        'Hearthstone_2025_01_02_08_00_00',
        'Hearthstone_2025_01_10_07_05_09',
        'Hearthstone_2025_1_99_00_00_00', // malformed
        'Power.log',
        'Hearthstone_2025_01_09_23_00_00',
        'zzz',
      ]),
    ).toBe('Hearthstone_2025_01_10_07_05_09');
  });
  it('returns undefined when there are no session folders', () => {
    expect(selectNewestLogFolder(['Power.log', 'foo'])).toBeUndefined();
  });
});

describe('resolvePowerLog', () => {
  it('uses the newest folder, else the legacy Logs/Power.log', () => {
    const logs = mkdtempSync(join(tmpdir(), 'tl-logs-'));
    expect(resolvePowerLog(logs)).toEqual({ path: join(logs, 'Power.log') });
    mkdirSync(join(logs, 'Hearthstone_2025_03_01_10_00_00'));
    mkdirSync(join(logs, 'Hearthstone_2025_03_02_09_00_00'));
    writeFileSync(join(logs, 'Hearthstone_2025_03_02_09_00_00.txt'), ''); // a file, not a folder
    expect(resolvePowerLog(logs)).toEqual({
      path: join(logs, 'Hearthstone_2025_03_02_09_00_00', 'Power.log'),
      sessionFolder: 'Hearthstone_2025_03_02_09_00_00',
    });
    expect(resolvePowerLog(join(logs, 'missing'))).toBeUndefined();
  });
});

describe('install discovery', () => {
  it('parses reg query output', () => {
    const out = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hearthstone',
      '    InstallLocation    REG_SZ    D:\\Games\\Hearthstone',
      '',
    ].join('\r\n');
    expect(parseRegQueryInstallLocation(out)).toBe('D:\\Games\\Hearthstone');
    expect(parseRegQueryInstallLocation('ERROR: nothing')).toBeUndefined();
  });

  it('prefers override, then registry, then defaults', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tl-hs-'));
    const a = join(root, 'a');
    const b = join(root, 'b');
    const c = join(root, 'c');
    for (const d of [a, b, c]) mkdirSync(join(d, 'Logs'), { recursive: true });
    const notHs = join(root, 'nope');
    mkdirSync(notHs);
    expect(await findHearthstoneInstall({ override: a, registryLookup: async () => [b], candidates: [c] })).toBe(a);
    expect(await findHearthstoneInstall({ override: notHs, registryLookup: async () => [b], candidates: [c] })).toBe(b);
    expect(await findHearthstoneInstall({ registryLookup: async () => [notHs], candidates: [notHs, c] })).toBe(c);
    expect(await findHearthstoneInstall({ registryLookup: async () => [], candidates: [notHs] })).toBeUndefined();
  });
});
