/**
 * Tavern Lens main-process orchestrator: windows, tray, hotkeys, Hearthstone
 * discovery, log tailing, demo replay, persistence and IPC.
 */
import { basename, dirname, join } from 'node:path';
import { BrowserWindow, app, dialog, net, screen, shell } from 'electron';
import type { WebContents } from 'electron';
import { IPC } from '@shared/ipc';
import type {
  AppStatus,
  BattleSimResult,
  BgEvent,
  BgGameState,
  GameWindowInfo,
  HeroStatsBundle,
  Settings,
  WidgetId,
} from '@shared/types';
import { CardDb } from '@core/cards/cardDb';
import { CardDataService } from './cardData';
import { DEFAULT_DEMO_SPEED, DEMO_LOG_FILE, DemoPlayer, loadDemoLines } from './demo';
import { isDev, resourcesDir } from './env';
import { GameFeed } from './gameFeed';
import { ensureLogConfigFile, logConfigPath } from './hearthstone/logConfig';
import { LogTailer } from './hearthstone/logTailer';
import { findHearthstoneInstall, logsDirFor, looksLikeHearthstoneInstall, resolvePowerLog } from './hearthstone/paths';
import { GameWindowTracker } from './hearthstone/windowTracker';
import { CommunityHeroStatsProvider, personalBundles } from './heroStats';
import { registerHotkeys, unregisterHotkeys, type HotkeyAction } from './hotkeys';
import { registerIpcHandlers } from './ipcHandlers';
import { createLogger } from './logger';
import { overlayBounds, shouldShowOverlay } from './overlayPolicy';
import { StatusStore } from './status';
import { Store, mergeSimPredictions } from './store';
import { createTracker } from './trackerFactory';
import { AppTray } from './tray';
import { createOverlayWindow, createSettingsWindow } from './windows';

const log = createLogger('app');

const DEMO_LINGER_MS = 12000;
const DISCOVERY_RETRY_MS = 30000;
const HS_NOT_FOUND = 'Hearthstone installation not found. Set the folder in Settings.';

export interface AppLaunchOptions {
  /** Started at login / with --hidden: don't pop the companion window. */
  hidden: boolean;
}

export class TavernLensApp {
  private store!: Store;
  private status!: StatusStore;
  private cardData!: CardDataService;
  private community!: CommunityHeroStatsProvider;
  private live!: GameFeed;
  private demoFeed: GameFeed | undefined;
  private demo!: DemoPlayer;
  private demoActive = false;
  private demoLingerTimer: ReturnType<typeof setTimeout> | undefined;
  private tailer: LogTailer | undefined;
  private windowTracker!: GameWindowTracker;
  private tray!: AppTray;
  private overlay: BrowserWindow | undefined;
  private settingsWin: BrowserWindow | undefined;
  private logsDir: string | undefined;
  private discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private housekeepingTimer: ReturnType<typeof setInterval> | undefined;
  private quitting = false;
  private predictions = new Map<number, BattleSimResult>();
  private liveSpectating = false;
  private liveActive = false;
  private pendingCardDb: CardDb | undefined;
  private hotkeyErrors: string[] = [];
  private hotkeysActive = false;

  async init(opts: AppLaunchOptions): Promise<void> {
    const userData = app.getPath('userData');
    this.store = new Store(userData);
    const settings = this.store.getSettings();

    const bundled = CardDb.bundled();
    this.status = new StatusStore(
      {
        version: app.getVersion(),
        platform: process.platform,
        cardData: { build: bundled.build, patch: bundled.patch, source: 'bundled', cards: bundled.size },
      },
      (s) => this.onStatusChanged(s),
    );

    const fetchImpl: typeof fetch = (input, init) => net.fetch(input as string, init as RequestInit);
    this.cardData = new CardDataService({
      cacheDir: join(userData, 'cache', 'cards'),
      bundled,
      fetch: fetchImpl,
      onUpdate: (db) => this.onCardDataUpdated(db),
    });
    this.community = new CommunityHeroStatsProvider({
      cacheDir: join(userData, 'cache'),
      fetch: fetchImpl,
      normalize: (id) => this.cardData.current.baseHeroId(id),
    });

    const logTransitions = isDev() || !!process.env.TL_DEBUG;
    this.live = new GameFeed({
      label: 'live',
      tracker: createTracker(bundled),
      logTransitions,
      onState: (s) => this.onLiveState(s),
      onEvents: (e) => this.onLiveEvents(e),
    });
    this.demo = new DemoPlayer({
      loadLines: () => loadDemoLines(join(resourcesDir(), 'demo', DEMO_LOG_FILE)),
      onLines: (lines) => this.demoFeed?.feed(lines),
      onProgress: (progress) =>
        this.status.update({ demo: { running: true, progress: Math.round(progress * 1000) / 1000, speed: this.demo.speed } }),
      onFinished: () => {
        log.info('demo finished');
        this.demoLingerTimer = setTimeout(() => this.stopDemo(), DEMO_LINGER_MS);
      },
    });

    registerIpcHandlers({
      getState: () => this.activeFeed().getState(),
      getStatus: () => this.status.get(),
      getSettings: () => this.store.getSettings(),
      setSettings: (patch) => this.setSettings(patch),
      getHistory: () => this.store.getHistory(),
      clearHistory: () => {
        this.store.clearHistory();
        this.broadcast(IPC.historyChanged, this.store.getHistory());
      },
      getCardData: () => this.cardData.current.data,
      getHeroStats: () => this.getHeroStats(),
      reportSimResult: (turn, result) => this.reportSimResult(turn, result),
      startDemo: (speed) => this.startDemo(speed),
      stopDemo: () => this.stopDemo(),
      pickHearthstonePath: (sender) => this.pickHearthstonePath(sender),
      fixLogConfig: async () => this.fixLogConfig(),
      setInteractive: (sender, interactive) => this.setInteractive(sender, interactive),
      openSettings: () => this.showSettings(),
      openExternal: (url) => void shell.openExternal(url),
      quit: () => app.quit(),
    });

    // Windows
    this.overlay = createOverlayWindow(this.fallbackBounds());
    this.overlay.on('closed', () => (this.overlay = undefined));
    this.watchOverlayRenderer(this.overlay);
    if (this.store.firstRun || (isDev() && !opts.hidden) || process.argv.includes('--show')) this.showSettings();

    // Tray & hotkeys
    this.tray = new AppTray({
      toggleOverlay: () => this.setSettings({ overlayEnabled: !this.store.getSettings().overlayEnabled }),
      openApp: () => this.showSettings(),
      toggleDemo: () => (this.demoActive ? this.stopDemo() : void this.startDemo()),
      quit: () => app.quit(),
    });
    this.tray.create(this.trayState());
    this.applyHotkeys(settings);
    this.applyLoginItem(settings);

    // Game window tracking
    this.windowTracker = new GameWindowTracker({
      onChange: (info) => this.onGameWindow(info),
      toDip: process.platform === 'win32' ? (r) => screen.screenToDipRect(null, r) : undefined,
    });
    this.windowTracker.start();
    screen.on('display-metrics-changed', () => this.updateOverlay());
    screen.on('display-added', () => this.updateOverlay());
    screen.on('display-removed', () => this.updateOverlay());

    // Hearthstone logs
    this.status.update({ logConfig: ensureLogConfigFile(logConfigPath()) });
    void this.discover();

    // Background data
    this.cardData.start();
    if (settings.communityStats) setTimeout(() => this.community.prefetch(), 5000);

    this.housekeepingTimer = setInterval(() => this.housekeeping(), 5000);
    this.updateOverlay();

    app.on('before-quit', () => this.shutdown());

    if (isDev() && process.env.TL_AUTODEMO) {
      const speed = Number(process.env.TL_DEMO_SPEED) || DEFAULT_DEMO_SPEED;
      setTimeout(() => void this.startDemo(speed), 1500);
    }
    log.info(`Tavern Lens ${app.getVersion()} started (${process.platform}, ${isDev() ? 'dev' : 'packaged'})`);
  }

  // ------------------------------------------------------------------ windows

  showSettings(): void {
    if (!this.settingsWin || this.settingsWin.isDestroyed()) {
      const win = createSettingsWindow();
      this.settingsWin = win;
      win.once('ready-to-show', () => win.show());
      win.on('close', (e) => {
        if (!this.quitting) {
          e.preventDefault();
          win.hide();
        }
      });
      win.on('closed', () => {
        if (this.settingsWin === win) this.settingsWin = undefined;
      });
      // If the page never becomes ready (e.g. renderer not built), still show the frame.
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible() && this.settingsWin === win) win.show();
      }, 4000);
      return;
    }
    const win = this.settingsWin;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  private fallbackBounds(): Electron.Rectangle {
    return screen.getPrimaryDisplay().workArea;
  }

  private updateOverlay(): void {
    const win = this.overlay;
    if (!win || win.isDestroyed()) return;
    const s = this.store.getSettings();
    const info = this.windowTracker?.info ?? { found: false, focused: false, minimized: false };
    const policy = {
      overlayEnabled: s.overlayEnabled,
      hideWhenUnfocused: s.hideWhenUnfocused,
      demoRunning: this.demoActive,
      window: info,
      trackerSupported: this.windowTracker?.supported ?? false,
      gameActive: this.liveActive,
    };
    const visible = shouldShowOverlay(policy);
    // Hotkeys are held while the overlay could show (the game is in front, or the demo
    // runs), so toggleOverlay still works when the overlay is disabled.
    this.setHotkeysActive(shouldShowOverlay({ ...policy, overlayEnabled: true }));
    const bounds = overlayBounds({ demoRunning: this.demoActive, window: info, fallback: this.fallbackBounds() });
    const cur = win.getBounds();
    if (cur.x !== bounds.x || cur.y !== bounds.y || cur.width !== bounds.width || cur.height !== bounds.height) {
      win.setBounds(bounds);
    }
    if (visible && !win.isVisible()) {
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
      log.debug('overlay shown', bounds);
    } else if (!visible && win.isVisible()) {
      win.setIgnoreMouseEvents(true, { forward: true });
      win.hide();
      log.debug('overlay hidden');
    }
  }

  private setInteractive(sender: WebContents, interactive: boolean): void {
    const win = this.overlay;
    if (!win || win.isDestroyed() || sender !== win.webContents) return;
    // A hidden overlay stays click-through (it is reset on hide), so it can't come back
    // capturing the mouse from a request that raced the hide.
    if (interactive && !win.isVisible()) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  /**
   * The renderer tracks whether it asked for the window to be interactive. If it reloads
   * or crashes while it was, nothing would ever make the window click-through again and
   * the transparent overlay would swallow every click meant for the game.
   */
  private watchOverlayRenderer(win: BrowserWindow): void {
    const wc = win.webContents;
    const clickThrough = () => {
      if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
    };
    let lastCrashReload = 0;
    wc.on('did-start-loading', clickThrough);
    wc.on('render-process-gone', (_e, details) => {
      clickThrough();
      if (this.quitting || details.reason === 'clean-exit') return;
      // Bring the widgets back, but don't spin if the page keeps crashing.
      const now = Date.now();
      if (now - lastCrashReload < 60000) return;
      lastCrashReload = now;
      setTimeout(() => {
        if (!win.isDestroyed() && !this.quitting) wc.reload();
      }, 1000);
    });
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of [this.overlay, this.settingsWin]) {
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send(channel, payload);
      } catch (err) {
        log.debug(`send ${channel} failed`, err);
      }
    }
  }

  private trayState() {
    const st = this.status.get();
    return {
      overlayEnabled: this.store.getSettings().overlayEnabled,
      demoRunning: this.demoActive,
      statusLine: this.demoActive
        ? 'Demo running'
        : st.gameWindow.found
          ? 'Hearthstone running'
          : st.hearthstoneInstallPath
            ? 'Waiting for Hearthstone'
            : 'Hearthstone not found',
    };
  }

  // --------------------------------------------------------------- settings

  private setSettings(patch: Partial<Settings>): Settings {
    const prev = this.store.getSettings();
    const next = this.store.updateSettings(patch);
    if (JSON.stringify(prev.hotkeys) !== JSON.stringify(next.hotkeys)) this.applyHotkeys(next);
    if (prev.launchOnStartup !== next.launchOnStartup) this.applyLoginItem(next);
    if ((prev.hearthstonePath ?? '') !== (next.hearthstonePath ?? '')) void this.discover();
    if (!prev.communityStats && next.communityStats) this.community.prefetch();
    this.updateOverlay();
    this.tray?.update(this.trayState());
    this.broadcast(IPC.settingsChanged, next);
    return next;
  }

  private setHotkeysActive(active: boolean): void {
    if (active === this.hotkeysActive) return;
    this.hotkeysActive = active;
    if (active) this.applyHotkeys(this.store.getSettings());
    else unregisterHotkeys();
  }

  private applyHotkeys(s: Settings): void {
    for (const e of this.hotkeyErrors) this.status.clearError((x) => x === e);
    this.hotkeyErrors = registerHotkeys(s.hotkeys, (action) => this.onHotkey(action));
    // Global shortcuts are system-wide: holding Ctrl/Cmd+Shift+T/O/H while Hearthstone is
    // not in front would take them from every other app (reopen tab, bookmarks...). When
    // inactive, registering just validated the accelerators.
    if (!this.hotkeysActive) unregisterHotkeys();
    for (const e of this.hotkeyErrors) this.status.addError(e);
  }

  private onHotkey(action: HotkeyAction): void {
    log.debug(`hotkey ${action}`);
    if (action === 'toggleOverlay') {
      this.setSettings({ overlayEnabled: !this.store.getSettings().overlayEnabled });
      return;
    }
    const widget: WidgetId = action === 'toggleTierList' ? 'tierList' : 'opponentsPanel';
    const win = this.overlay;
    if (win && !win.isDestroyed()) win.webContents.send(IPC.toggleWidget, widget);
  }

  private applyLoginItem(s: Settings): void {
    if (!app.isPackaged) return; // would register the dev Electron binary
    try {
      const portable = process.env.PORTABLE_EXECUTABLE_FILE;
      const current = app.getLoginItemSettings(portable ? { path: portable } : undefined).openAtLogin;
      if (current === s.launchOnStartup) return;
      app.setLoginItemSettings({
        openAtLogin: s.launchOnStartup,
        args: ['--hidden'],
        ...(portable ? { path: portable } : {}),
      });
    } catch (err) {
      log.warn('could not update login item', err);
    }
  }

  // ------------------------------------------------------------- hearthstone

  private async discover(): Promise<void> {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = undefined;
    const override = this.store.getSettings().hearthstonePath;
    const install = await findHearthstoneInstall({ override });
    this.logsDir = install ? logsDirFor(install) : undefined;
    this.status.update({ hearthstoneInstallPath: install, logsPath: this.logsDir });
    if (install) {
      this.status.clearError((e) => e === HS_NOT_FOUND);
      log.info(`Hearthstone found at ${install}`);
    } else {
      if (this.windowTracker.supported) this.status.addError(HS_NOT_FOUND);
      this.discoveryTimer = setTimeout(() => void this.discover(), DISCOVERY_RETRY_MS);
    }
    if (!this.tailer) {
      this.tailer = new LogTailer({
        resolvePath: () => (this.logsDir ? resolvePowerLog(this.logsDir)?.path : undefined),
        onLines: (lines) => this.live.feed(lines),
        onFileChange: ({ path, reason }) => {
          this.status.update({ powerLogPath: path, watching: !!path });
          // A new client session (or a truncated log): finish a game whose end was already
          // seen, and keep one in progress so a reconnect after a client restart continues it.
          if (reason !== 'initial') this.live.restartLog();
        },
      });
      this.tailer.start();
    } else {
      this.tailer.refreshPath();
    }
  }

  private fixLogConfig(): AppStatus['logConfig'] {
    const result = ensureLogConfigFile(logConfigPath());
    this.status.update({ logConfig: result });
    return result;
  }

  private async pickHearthstonePath(sender: WebContents): Promise<string | undefined> {
    const parent = BrowserWindow.fromWebContents(sender) ?? this.settingsWin;
    const opts: Electron.OpenDialogOptions = {
      title: 'Select your Hearthstone folder',
      properties: ['openDirectory'],
      defaultPath:
        this.status.get().hearthstoneInstallPath ??
        (process.platform === 'win32' ? 'C:\\Program Files (x86)' : process.platform === 'darwin' ? '/Applications' : undefined),
    };
    const res = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return undefined;
    let dir = res.filePaths[0];
    // Accept the Logs folder or the .app bundle as well.
    if (/^logs$/i.test(basename(dir)) || /\.app$/i.test(dir)) dir = dirname(dir);
    if (!looksLikeHearthstoneInstall(dir)) {
      this.status.addError(`"${dir}" doesn't look like a Hearthstone installation.`);
      return undefined;
    }
    this.setSettings({ hearthstonePath: dir });
    return dir;
  }

  private onGameWindow(info: GameWindowInfo): void {
    this.status.update({ gameWindow: info });
    this.updateOverlay();
  }

  private housekeeping(): void {
    const t = this.tailer;
    const recentLog = !!t && t.lastActivityAt > 0 && Date.now() - t.lastActivityAt < 120000;
    this.status.update({
      hearthstoneRunning: this.windowTracker.info.found || recentLog,
      watching: !!t && t.isRunning && !!t.currentPath,
      powerLogPath: t?.currentPath,
    });
    this.tray.update(this.trayState());
    this.maybeSwapTracker();
    this.live.tick();
    this.demoFeed?.tick();
  }

  // ------------------------------------------------------------- game state

  private activeFeed(): GameFeed {
    return this.demoActive && this.demoFeed ? this.demoFeed : this.live;
  }

  private onLiveState(state: BgGameState): void {
    if (state.active !== this.liveActive) {
      this.liveActive = state.active;
      this.updateOverlay();
    }
    if (!this.demoActive) this.broadcast(IPC.state, state);
  }

  private onLiveEvents(events: BgEvent[]): void {
    for (const e of events) {
      if (e.type === 'gameStart') {
        this.predictions.clear();
        this.liveSpectating = e.spectating;
      } else if (e.type === 'gameEnd') {
        if (this.liveSpectating) {
          log.info('spectated game ended; not saved to history');
        } else {
          const record = mergeSimPredictions(e.record, this.predictions);
          this.store.addMatch(record);
          log.info(`saved match ${record.id}: ${record.heroName} #${record.placement}`);
          this.broadcast(IPC.historyChanged, this.store.getHistory());
        }
        this.predictions.clear();
      }
    }
    if (!this.demoActive) for (const e of events) this.broadcast(IPC.event, e);
  }

  private reportSimResult(turn: number, result: BattleSimResult): void {
    if (this.demoActive) return; // demo games are never saved
    this.predictions.set(turn, result);
  }

  private onCardDataUpdated(db: CardDb): void {
    this.status.update({
      cardData: { build: db.build, patch: db.patch, source: 'downloaded', cards: db.size },
    });
    this.pendingCardDb = db;
    this.maybeSwapTracker();
  }

  /** Swap the live tracker to new card data once no game is (or was just) shown. */
  private maybeSwapTracker(): void {
    const db = this.pendingCardDb;
    if (!db) return;
    const s = this.live.getState();
    const over = s.phase === 'gameOver';
    const recentlyEnded = over && Date.now() - (s.endedAt ?? 0) < 60000;
    if ((s.active && !over) || recentlyEnded) return;
    this.pendingCardDb = undefined;
    this.live.replaceTracker(createTracker(db));
    log.info(`live tracker now uses card data build ${db.build}`);
  }

  private async getHeroStats(): Promise<HeroStatsBundle[]> {
    const db = this.cardData.current;
    const bundles = personalBundles(this.store.getHistory(), (id) => db.baseHeroId(id));
    if (this.store.getSettings().communityStats) {
      try {
        bundles.push(...(await this.community.getBundles()));
      } catch (err) {
        log.warn('community stats failed', err);
      }
    }
    return bundles;
  }

  // -------------------------------------------------------------------- demo

  private async startDemo(speed?: number): Promise<void> {
    this.stopDemo(false);
    const s = speed && speed > 0 ? speed : DEFAULT_DEMO_SPEED;
    this.demoActive = true;
    this.demoFeed = new GameFeed({
      label: 'demo',
      tracker: createTracker(this.cardData.current),
      logTransitions: isDev() || !!process.env.TL_DEBUG,
      onState: (st) => {
        if (this.demoActive) this.broadcast(IPC.state, st);
      },
      onEvents: (events) => {
        if (this.demoActive) for (const e of events) this.broadcast(IPC.event, e);
      },
    });
    this.status.update({ demo: { running: true, progress: 0, speed: s } });
    this.updateOverlay();
    this.tray.update(this.trayState());
    this.demoFeed.publishNow();
    try {
      await this.demo.start(s);
    } catch (err) {
      log.error('demo failed to start', err);
      this.status.addError(`Demo failed: ${(err as Error)?.message ?? err}`);
      this.stopDemo();
    }
  }

  private stopDemo(publishLive = true): void {
    if (this.demoLingerTimer) clearTimeout(this.demoLingerTimer);
    this.demoLingerTimer = undefined;
    const wasActive = this.demoActive;
    this.demo?.stop();
    this.demoActive = false;
    this.demoFeed?.dispose();
    this.demoFeed = undefined;
    if (!wasActive) return;
    log.info('demo stopped');
    this.status.update({ demo: { running: false } });
    if (publishLive) this.live.publishNow();
    this.updateOverlay();
    this.tray?.update(this.trayState());
  }

  // ------------------------------------------------------------------ status

  private onStatusChanged(s: AppStatus): void {
    this.broadcast(IPC.status, s);
  }

  // -------------------------------------------------------------- lifecycle

  private shutdown(): void {
    if (this.quitting) return;
    this.quitting = true;
    log.info('shutting down');
    try {
      unregisterHotkeys();
      this.tailer?.stop();
      this.windowTracker?.stop();
      this.cardData?.stop();
      this.demo?.stop();
      if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
      if (this.housekeepingTimer) clearInterval(this.housekeepingTimer);
      this.store.settingsFile.writeSync(this.store.getSettings());
      this.store.historyFile.writeSync(this.store.getHistory());
      this.tray?.destroy();
    } catch (err) {
      log.error('shutdown error', err);
    }
  }
}
