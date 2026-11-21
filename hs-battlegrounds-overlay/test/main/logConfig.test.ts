import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureLogConfigFile, ensurePowerLogConfig, logConfigPath } from '../../src/main/hearthstone/logConfig';

const POWER_OK = '[Power]\nLogLevel=1\nFilePrinting=true\nConsolePrinting=false\nScreenPrinting=false\nVerbose=true\n';

describe('ensurePowerLogConfig', () => {
  it('creates the section in an empty file', () => {
    const r = ensurePowerLogConfig('');
    expect(r.changed).toBe(true);
    expect(r.content).toBe(POWER_OK);
  });

  it('leaves a correct file untouched (case-insensitive values)', () => {
    const src = '[Power]\r\nLogLevel=1\r\nFilePrinting=True\r\nConsolePrinting=False\r\nScreenPrinting=false\r\nVerbose=TRUE\r\n';
    const r = ensurePowerLogConfig(src);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(src);
  });

  it('fixes wrong values, adds missing keys and preserves other sections', () => {
    const src = [
      '; my comment',
      '[Achievements]',
      'LogLevel=1',
      'FilePrinting=true',
      '',
      '[Power]',
      'LogLevel=0',
      'FilePrinting = false',
      'Custom=42',
      '',
      '[Zone]',
      'LogLevel=1',
      '',
    ].join('\n');
    const r = ensurePowerLogConfig(src);
    expect(r.changed).toBe(true);
    const lines = r.content.split('\n');
    expect(lines.slice(0, 5)).toEqual(['; my comment', '[Achievements]', 'LogLevel=1', 'FilePrinting=true', '']);
    const power = lines.slice(lines.indexOf('[Power]'), lines.indexOf('[Zone]'));
    expect(power).toEqual([
      '[Power]',
      'LogLevel=1',
      'FilePrinting=true',
      'Custom=42',
      'ConsolePrinting=false',
      'ScreenPrinting=false',
      'Verbose=true',
      '',
    ]);
    expect(lines.slice(lines.indexOf('[Zone]'))).toEqual(['[Zone]', 'LogLevel=1', '']);
    // idempotent
    expect(ensurePowerLogConfig(r.content).changed).toBe(false);
  });

  it('appends the section after existing content and keeps CRLF', () => {
    const r = ensurePowerLogConfig('[Zone]\r\nLogLevel=1');
    expect(r.content).toBe(
      '[Zone]\r\nLogLevel=1\r\n\r\n[Power]\r\nLogLevel=1\r\nFilePrinting=true\r\nConsolePrinting=false\r\nScreenPrinting=false\r\nVerbose=true\r\n',
    );
  });

  it('removes duplicate keys inside [Power]', () => {
    const r = ensurePowerLogConfig(POWER_OK + 'LogLevel=0\n');
    expect(r.changed).toBe(true);
    expect(r.content).toBe(POWER_OK);
  });
});

describe('ensureLogConfigFile', () => {
  it('creates, then reports ok, then updates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-logcfg-'));
    const file = join(dir, 'Blizzard', 'Hearthstone', 'log.config');
    expect(ensureLogConfigFile(file)).toBe('missing-restart-required');
    expect(readFileSync(file, 'utf8')).toBe(POWER_OK);
    expect(ensureLogConfigFile(file)).toBe('ok');
    writeFileSync(file, '[Power]\nLogLevel=1\n');
    expect(ensureLogConfigFile(file)).toBe('updated');
    expect(readFileSync(file, 'utf8')).toBe(POWER_OK);
  });

  it('returns unknown without a path', () => {
    expect(ensureLogConfigFile(undefined)).toBe('unknown');
  });

  it('knows the platform locations', () => {
    expect(logConfigPath('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })).toMatch(
      /Blizzard[\\/]Hearthstone[\\/]log\.config$/,
    );
    expect(logConfigPath('darwin')).toMatch(/Library[\\/]Preferences[\\/]Blizzard[\\/]Hearthstone[\\/]log\.config$/);
    expect(logConfigPath('linux')).toBeUndefined();
  });
});
