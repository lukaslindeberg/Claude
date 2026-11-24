import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, net: {}, shell: {} }));
const { isNewerVersion, parseLatestVersion } = await import('../../src/main/updater');

describe('update channel helpers', () => {
  it('reads the version from latest.yml', () => {
    const yml = "version: 1.0.142\nfiles:\n  - url: Tavern-Lens-Setup-1.0.142.exe\n    sha512: abc\npath: Tavern-Lens-Setup-1.0.142.exe\nreleaseDate: '2026-11-18T09:00:00.000Z'\n";
    expect(parseLatestVersion(yml)).toBe('1.0.142');
    expect(parseLatestVersion("version: '2.1.0'\n")).toBe('2.1.0');
    expect(parseLatestVersion('files: []\n')).toBeUndefined();
  });

  it('compares versions numerically', () => {
    expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true);
    expect(isNewerVersion('1.0.9', '1.0.10')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.1', '1.0.99')).toBe(true);
    expect(isNewerVersion('1.0.5-beta', '1.0.4')).toBe(true);
  });
});
