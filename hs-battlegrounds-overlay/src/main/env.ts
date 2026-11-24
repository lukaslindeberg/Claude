/**
 * Runtime paths for the Electron main process (dev vs packaged).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { createLogger } from './logger';

const log = createLogger('env');

/** Directory of the bundled main script (`out/main`). */
export const MAIN_DIR = dirname(fileURLToPath(import.meta.url));

export const isDev = (): boolean => !app.isPackaged;

/** `resources/` in development, `process.resourcesPath` (extraResources) when packaged. */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
}

export function iconPath(name: string): string {
  return join(resourcesDir(), 'icons', name);
}

export function preloadPath(): string {
  return join(MAIN_DIR, '../preload/index.cjs');
}

export type PageName = 'overlay' | 'settings';

/** Loads a renderer page: Vite dev server in development, built HTML otherwise. */
export async function loadPage(win: BrowserWindow, page: PageName): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  try {
    if (!app.isPackaged && devUrl) {
      await win.loadURL(`${devUrl.replace(/\/$/, '')}/${page}.html`);
      return;
    }
    const file = join(MAIN_DIR, '../renderer', `${page}.html`);
    if (!existsSync(file)) {
      log.warn(`renderer page missing: ${file} (run \`electron-vite build\`)`);
      return;
    }
    await win.loadFile(file);
  } catch (err) {
    log.error(`failed to load ${page} page`, err);
  }
}

/** Is `url` one of our own renderer pages? */
export function isAppUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && url.startsWith(devUrl)) return true;
  return url.startsWith('file://') && url.includes('/renderer/');
}
