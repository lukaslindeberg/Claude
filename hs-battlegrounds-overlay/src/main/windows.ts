/**
 * BrowserWindow factories: the transparent click-through overlay and the
 * framed companion/settings window.
 */
import { BrowserWindow, shell } from 'electron';
import type { Rectangle } from 'electron';
import { iconPath, isAppUrl, loadPage, preloadPath } from './env';
import { createLogger } from './logger';

const log = createLogger('windows');

export const SETTINGS_BG = '#0b0d16';

function harden(win: BrowserWindow, label: string): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  wc.on('render-process-gone', (_e, details) => log.error(`${label} renderer gone: ${details.reason}`));
  wc.on('console-message', (e) => {
    if (e.level === 'error') log.warn(`[${label} console] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => log.error(`${label} failed to load ${url}: ${code} ${desc}`));
}

export function createOverlayWindow(bounds: Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // macOS: a non-activating NSPanel, so clicking the overlay doesn't make Tavern Lens
    // the frontmost app (which would take focus from Hearthstone and hide the overlay).
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    title: 'Tavern Lens Overlay',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      additionalArguments: ['--tl-window=overlay'],
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  harden(win, 'overlay');
  void loadPage(win, 'overlay');
  return win;
}

export function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Tavern Lens',
    backgroundColor: SETTINGS_BG,
    autoHideMenuBar: true,
    icon: process.platform === 'darwin' ? undefined : iconPath('icon-256.png'),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: ['--tl-window=settings'],
    },
  });
  win.setMenuBarVisibility(false);
  harden(win, 'settings');
  void loadPage(win, 'settings');
  return win;
}
