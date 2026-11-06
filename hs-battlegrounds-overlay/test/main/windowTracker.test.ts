import { describe, expect, it } from 'vitest';
import {
  WINDOWS_HELPER_SCRIPT,
  buildWindowsHelperCommand,
  parseHelperLine,
  parseMacOutput,
} from '../../src/main/hearthstone/windowTracker';
import { overlayBounds, shouldShowOverlay } from '../../src/main/overlayPolicy';

describe('window helper output', () => {
  it('parses Windows helper lines', () => {
    expect(parseHelperLine('{"found":false}')).toEqual({ found: false, focused: false, minimized: false });
    expect(parseHelperLine('{"found":true,"focused":true,"minimized":false,"x":10,"y":20,"w":1920,"h":1080}\r')).toEqual({
      found: true,
      focused: true,
      minimized: false,
      bounds: { x: 10, y: 20, width: 1920, height: 1080 },
    });
    expect(parseHelperLine('{"found":true,"focused":false,"minimized":true}')).toEqual({
      found: true,
      focused: false,
      minimized: true,
    });
    expect(parseHelperLine('Add-Type : some error')).toBeUndefined();
    expect(parseHelperLine('{broken')).toBeUndefined();
  });

  it('builds a single-line PowerShell command embedding the helper', () => {
    const cmd = buildWindowsHelperCommand(1234);
    expect(cmd.trimEnd().split('\n')).toHaveLength(1);
    const b64 = /FromBase64String\('([^']+)'\)/.exec(cmd)![1];
    const script = Buffer.from(b64, 'base64').toString('utf8');
    expect(script).toContain('$parentPid = 1234');
    expect(script).toContain('FindWindow("UnityWndClass", "Hearthstone")');
    expect(WINDOWS_HELPER_SCRIPT).toContain('SetProcessDPIAware');
  });

  it('parses macOS osascript output', () => {
    expect(parseMacOutput('notrunning\n')).toEqual({ found: false, focused: false, minimized: false });
    expect(parseMacOutput('true, 0, 25, 1440, 900, false')).toEqual({
      found: true,
      focused: true,
      minimized: false,
      bounds: { x: 0, y: 53, width: 1440, height: 872 },
    });
    expect(parseMacOutput('false,0,0,1728,1117,true')?.bounds).toEqual({ x: 0, y: 0, width: 1728, height: 1117 });
    expect(parseMacOutput('true,,,,,')).toEqual({ found: true, focused: true, minimized: true });
    expect(parseMacOutput('execution error')).toBeUndefined();
  });
});

describe('overlay policy', () => {
  const base = {
    overlayEnabled: true,
    hideWhenUnfocused: true,
    demoRunning: false,
    trackerSupported: true,
    gameActive: false,
    window: { found: true, focused: true, minimized: false },
  };
  it('decides visibility', () => {
    expect(shouldShowOverlay(base)).toBe(true);
    expect(shouldShowOverlay({ ...base, overlayEnabled: false, demoRunning: true })).toBe(false);
    expect(shouldShowOverlay({ ...base, window: { found: false, focused: false, minimized: false } })).toBe(false);
    expect(shouldShowOverlay({ ...base, window: { found: true, focused: false, minimized: false } })).toBe(false);
    expect(
      shouldShowOverlay({ ...base, hideWhenUnfocused: false, window: { found: true, focused: false, minimized: false } }),
    ).toBe(true);
    expect(shouldShowOverlay({ ...base, window: { found: true, focused: true, minimized: true } })).toBe(false);
    expect(
      shouldShowOverlay({ ...base, demoRunning: true, window: { found: false, focused: false, minimized: false } }),
    ).toBe(true);
    expect(shouldShowOverlay({ ...base, trackerSupported: false, gameActive: true })).toBe(true);
    expect(shouldShowOverlay({ ...base, trackerSupported: false, gameActive: false })).toBe(false);
  });
  it('positions over the game or the fallback display', () => {
    const fallback = { x: 0, y: 0, width: 1920, height: 1040 };
    const window = { found: true, focused: true, minimized: false, bounds: { x: 100.4, y: 50, width: 1280, height: 720 } };
    expect(overlayBounds({ demoRunning: false, window, fallback })).toEqual({ x: 100, y: 50, width: 1280, height: 720 });
    expect(overlayBounds({ demoRunning: true, window, fallback })).toEqual(fallback);
    expect(overlayBounds({ demoRunning: false, window: { ...window, bounds: undefined }, fallback })).toEqual(fallback);
  });
});
