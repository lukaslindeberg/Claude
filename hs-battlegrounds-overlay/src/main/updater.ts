/**
 * App updates from the public release channel (a rolling GitHub release that CI
 * refreshes with every build).
 *
 * - Windows installer (NSIS): electron-updater downloads the new installer in the
 *   background and installs it when the app quits (or right away from About).
 * - macOS and the Windows portable build: unsigned apps can't replace themselves, so
 *   we only read the channel's version and offer the download page.
 */
import { app, net, shell } from 'electron';
import type { UpdateStatus } from '@shared/types';
import { createLogger } from './logger';

const log = createLogger('updater');

/** Where CI publishes builds (`latest.yml` + installers). */
export const UPDATE_FEED = 'https://github.com/lukaslindeberg/Claude/releases/download/tavern-lens-latest';
export const RELEASE_PAGE = 'https://github.com/lukaslindeberg/Claude/releases/tag/tavern-lens-latest';

const FIRST_CHECK_MS = process.env.TL_FORCE_UPDATES ? 2_000 : 20_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** The `version:` line of an electron-builder update file (latest.yml). */
export function parseLatestVersion(yml: string): string | undefined {
  const m = /^version:\s*['"]?([0-9]+(?:\.[0-9]+)*(?:-[0-9A-Za-z.-]+)?)['"]?\s*$/m.exec(yml);
  return m?.[1];
}

/** True when `a` is a newer x.y.z version than `b` (pre-release suffixes ignored). */
export function isNewerVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

type AutoUpdater = typeof import('electron-updater').autoUpdater;

export class Updater {
  private status: UpdateStatus;
  private auto: AutoUpdater | undefined;
  private timer: NodeJS.Timeout | undefined;
  private checking: Promise<void> | undefined;

  constructor(private readonly onChange: (status: UpdateStatus) => void) {
    // TL_FORCE_UPDATES=1 checks from a development build too ("installer" also loads electron-updater).
    const force = process.env.TL_FORCE_UPDATES;
    const enabled = (app.isPackaged || !!force) && !process.env.TL_NO_UPDATES;
    const installer = (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) || force === 'installer';
    this.status = { state: enabled ? 'idle' : 'disabled', canInstall: enabled && installer };
  }

  get(): UpdateStatus {
    return this.status;
  }

  start(): void {
    if (this.status.state === 'disabled') {
      log.info('updates disabled (development build)');
      return;
    }
    setTimeout(() => void this.check(), FIRST_CHECK_MS).unref();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Checks the channel now (no-op while a check or download is running). */
  check(): Promise<void> {
    if (this.status.state === 'disabled') return Promise.resolve();
    if (this.status.state === 'downloading' || this.status.state === 'ready') return Promise.resolve();
    this.checking ??= (this.status.canInstall ? this.checkInstaller() : this.checkVersionOnly()).finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  /** Installs a downloaded update (Windows installer) or opens the download page. */
  install(): void {
    if (this.status.state === 'ready' && this.auto) {
      log.info(`installing ${this.status.latest} now`);
      // isSilent=true, isForceRunAfter=true: install quietly and start the new version.
      this.auto.quitAndInstall(true, true);
      return;
    }
    void shell.openExternal(RELEASE_PAGE);
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }

  private async checkVersionOnly(): Promise<void> {
    this.set({ state: 'checking', error: undefined });
    try {
      const file = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
      let res = await net.fetch(`${UPDATE_FEED}/${file}`, { cache: 'no-store' });
      if (!res.ok && file !== 'latest.yml') res = await net.fetch(`${UPDATE_FEED}/latest.yml`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const latest = parseLatestVersion(await res.text());
      if (!latest) throw new Error('no version in update file');
      const newer = isNewerVersion(latest, app.getVersion());
      if (newer) log.info(`update available: ${app.getVersion()} -> ${latest}`);
      this.set({ state: newer ? 'available' : 'up-to-date', latest, checkedAt: new Date().toISOString() });
    } catch (err) {
      log.warn('update check failed', err);
      this.set({ state: 'error', error: errorText(err), checkedAt: new Date().toISOString() });
    }
  }

  private async checkInstaller(): Promise<void> {
    try {
      const auto = await this.autoUpdater();
      this.set({ state: 'checking', error: undefined });
      await auto.checkForUpdates();
    } catch (err) {
      log.warn('update check failed', err);
      this.set({ state: 'error', error: errorText(err), checkedAt: new Date().toISOString() });
    }
  }

  private async autoUpdater(): Promise<AutoUpdater> {
    if (this.auto) return this.auto;
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (m: unknown) => log.debug(String(m)),
      warn: (m: unknown) => log.warn(String(m)),
      error: (m: unknown) => log.error(String(m)),
      debug: (m: unknown) => log.debug(String(m)),
    };
    const now = () => new Date().toISOString();
    autoUpdater.on('update-not-available', (info) => this.set({ state: 'up-to-date', latest: info.version, checkedAt: now() }));
    autoUpdater.on('update-available', (info) => {
      log.info(`update available: ${app.getVersion()} -> ${info.version}, downloading`);
      this.set({ state: 'downloading', latest: info.version, progress: 0, checkedAt: now() });
    });
    autoUpdater.on('download-progress', (p) => {
      const progress = Math.round(p.percent) / 100;
      if (Math.abs(progress - (this.status.progress ?? 0)) >= 0.05) this.set({ progress });
    });
    autoUpdater.on('update-downloaded', (info) => {
      log.info(`update ${info.version} downloaded; installs when Tavern Lens quits`);
      this.set({ state: 'ready', latest: info.version, progress: 1 });
    });
    autoUpdater.on('error', (err) => {
      log.warn('updater error', err);
      this.set({ state: 'error', error: errorText(err), checkedAt: now() });
    });
    this.auto = autoUpdater;
    return autoUpdater;
  }
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n')[0].slice(0, 160);
}
