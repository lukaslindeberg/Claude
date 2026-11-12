/**
 * Tavern Lens main-process orchestrator: windows, tray, hotkeys, Hearthstone
 * discovery, log tailing, demo replay, persistence and IPC.
 */
import { basename, dirname, join } from 'node:path';
import { BrowserWindow, app, dialog, net, powerMonitor, screen, shell } from 'electron';
import type { WebContents } from 'electron';
import { IPC } from '@shared/ipc';
import type {
  AppStatus,
  BattleSimResult,
  BgEvent,
  BgGameState,
  DiagnosticsExportOptions,
  DiagnosticsExportResult,
  DiagnosticsStatus,
  GameWindowInfo,
  HeroStatsBundle,
  Settings,
  TrinketStatsBundle,
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
import { CommunityTrinketStatsProvider, personalTrinketBundles } from './trinketStats';
import { registerHotkeys, unregisterHotkeys, type HotkeyAction } from './hotkeys';
import { describeSim, describeVerdict, describeWindow, diffSettings } from './diagnostics/describe';
import { writeDiagnosticsZip, pickExportDir } from './diagnostics/export';
import { rendererLogs } from './diagnostics/rendererLog';
import { SIM_CASES_FILE, SimCaseLog, type SimCase } from './diagnostics/simCases';
import { sessionHeader, systemInfo } from './diagnostics/system';
import { registerIpcHandlers } from './ipcHandlers';
import { createLogger, getLogStats, isDebugLogging, logFilePath, onLogEntry, setDebugLogging } from './logger';
import { overlayBounds, overlayVisibility, shouldShowOverlay } from './overlayPolicy';
import { StatusStore } from './status';
import { Store, mergeSimPredictions } from './store';
import { createTracker } from './trackerFactory';
import { AppTray } from './tray';
import { createOverlayWindow, createSettingsWindow } from './windows';

const log = createLogger('app');
const simLog = createLogger('sim');
const diagLog = createLogger('diagnostics');

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
  private communityTrinkets!: CommunityTrinketStatsProvider;
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
  // diagnostics
  private appLogsDir = '';
  private simCases: SimCaseLog | undefined;
  private liveGameId = '';
  private demoGameId = '';
  private headerWritten = false;
  private hsNotFoundLogged = false;
  private overlayState: { visible: boolean; reason: string } | undefined;
  private loggedWindow: GameWindowInfo | undefined;
  private windowLogTimer: ReturnType<typeof setTimeout> | undefined;
  private interactive = false;
  private interactiveToggles = 0;
  private diagStatusTimer: ReturnType<typeof setTimeout> | undefined;
  private exporting = false;
  private readonly exportedPaths = new Set<string>();
  private readonly verdictsLogged = new Set<string>();

  async init(opts: AppLaunchOptions): Promise<void> {
    const userData = app.getPath('userData');
    this.store = new Store(userData);
    const settings = this.store.getSettings();
    setDebugLogging(!!settings.verboseLogging || !!process.env.TL_DEBUG);
    this.appLogsDir = join(userData, 'logs');
    this.simCases = new SimCaseLog({
      file: join(this.appLogsDir, SIM_CASES_FILE),
      meta: () => ({
        appVersion: app.getVersion(),
        cardBuild: this.cardData?.current.build ?? 0,
        cardSource: this.status?.get().cardData.source,
      }),
      onError: (err) => simLog.warn('could not write sim-cases.jsonl', err),
    });
    try {
      const t = this.simCases.trim();
      if (t.before !== t.after) simLog.info(`sim-cases.jsonl trimmed from ${t.before} to ${t.after} combats`);
    } catch (err) {
      simLog.warn('could not trim sim-cases.jsonl', err);
    }

    const bundled = CardDb.bundled();
    this.status = new StatusStore(
      {
        version: app.getVersion(),
        platform: process.platform,
        cardData: { build: bundled.build, patch: bundled.patch, source: 'bundled', cards: bundled.size },
      },
      (s) => this.onStatusChanged(s),
    );
    this.status.update({ diagnostics: this.diagStatus() });
    onLogEntry((e) => {
      if (e.level === 'error' || e.level === 'warn') this.scheduleDiagStatus();
    });

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
    this.communityTrinkets = new CommunityTrinketStatsProvider({ cacheDir: join(userData, 'cache'), fetch: fetchImpl });

    const logTransitions = !!process.env.TL_DEBUG;
    const cardName = (id: string) => this.cardData?.current.get(id)?.name;
    this.live = new GameFeed({
      label: 'live',
      tracker: createTracker(bundled),
      logTransitions,
      measureLag: true,
      cardName,
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
      getTrinketStats: () => this.getTrinketStats(),
      reportSimResult: (turn, result) => this.reportSimResult(turn, result),
      startDemo: (speed) => this.startDemo(speed),
      stopDemo: () => this.stopDemo(),
      pickHearthstonePath: (sender) => this.pickHearthstonePath(sender),
      fixLogConfig: async () => this.fixLogConfig(),
      setInteractive: (sender, interactive) => this.setInteractive(sender, interactive),
      openSettings: () => this.showSettings(),
      openExternal: (url) => void shell.openExternal(url),
      quit: () => app.quit(),
      exportDiagnostics: (o) => this.exportDiagnostics(o),
      openLogsFolder: () => this.openLogsFolder(),
      showItemInFolder: (path) => this.showItemInFolder(path),
      logEvent: (sender, level, scope, message, data) =>
        rendererLogs.handle(sender.id, this.windowName(sender), level, scope, message, data),
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
    const logConfig = ensureLogConfigFile(logConfigPath());
    this.status.update({ logConfig });
    if (logConfig !== 'ok') log.info(`log.config: ${logConfig} (${logConfigPath() ?? 'no known location on this platform'})`);
    // The session header waits for the first discovery (install and Power.log paths).
    void this.discover().finally(() => this.writeSessionHeader());
    setTimeout(() => this.writeSessionHeader(), 8000);
    powerMonitor.on('suspend', () => log.info('system suspending'));
    powerMonitor.on('resume', () => log.info('system resumed'));

    // Background data
    this.cardData.start();
    if (settings.communityStats) {
      setTimeout(() => {
        this.community.prefetch();
        this.communityTrinkets.prefetch();
      }, 5000);
    }

    this.housekeepingTimer = setInterval(() => this.housekeeping(), 5000);
    this.updateOverlay();

    app.on('before-quit', () => this.shutdown());

    if (isDev() && process.env.TL_AUTODEMO) {
      const speed = Number(process.env.TL_DEMO_SPEED) || DEFAULT_DEMO_SPEED;
      setTimeout(() => void this.startDemo(speed), 1500);
    }
    if (isDev() && process.env.TL_SMOKE_RENDERER_ERRORS) {
      // Smoke test: errors in both windows must reach the main log via bridge.logEvent.
      setTimeout(() => {
        for (const w of [this.overlay, this.settingsWin]) {
          if (!w || w.isDestroyed()) continue;
          const js = `setTimeout(() => { throw new Error('smoke: uncaught error'); }); Promise.reject(new Error('smoke: unhandled rejection')); console.error('smoke: console.error', { detail: 1 }); 0`;
          void w.webContents.executeJavaScript(js).catch(() => undefined);
        }
      }, 10000);
    }
    if (isDev() && process.env.TL_SMOKE_EXPORT) {
      // Smoke test: export shortly before TL_SMOKE_QUIT_MS quits (or after 20 s).
      const quitAfter = Number(process.env.TL_SMOKE_QUIT_MS) || 0;
      setTimeout(
        () =>
          void this.exportDiagnostics({ includeGameLogs: true }, false).then((r) =>
            diagLog.info(`TL_SMOKE_EXPORT: ${r.ok ? `${r.path} (${r.bytes} bytes)` : `failed: ${r.error}`}`),
          ),
        quitAfter > 15000 ? quitAfter - 7000 : 20000,
      );
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
    const decision = overlayVisibility(policy);
    const visible = decision.visible;
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
    } else if (!visible && win.isVisible()) {
      win.setIgnoreMouseEvents(true, { forward: true });
      this.interactive = false;
      win.hide();
    }
    const prev = this.overlayState;
    if (!prev || prev.visible !== visible || (!visible && prev.reason !== decision.reason)) {
      const b = `${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}`;
      log.info(`overlay ${visible ? 'shown' : 'hidden'}: ${decision.reason}${visible ? ` · bounds ${b}` : ''}`);
    }
    this.overlayState = decision;
  }

  private setInteractive(sender: WebContents, interactive: boolean): void {
    const win = this.overlay;
    if (!win || win.isDestroyed() || sender !== win.webContents) return;
    // A hidden overlay stays click-through (it is reset on hide), so it can't come back
    // capturing the mouse from a request that raced the hide.
    if (interactive && !win.isVisible()) {
      log.debug('setInteractive(true) ignored: overlay hidden');
      return;
    }
    win.setIgnoreMouseEvents(!interactive, { forward: true });
    if (interactive !== this.interactive) {
      this.interactive = interactive;
      this.interactiveToggles++;
      log.debug(`overlay ${interactive ? 'interactive (captures the mouse)' : 'click-through'}`);
    }
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
      this.interactive = false;
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
    const changes = diffSettings(prev, next);
    if (changes.length) log.info(`settings changed: ${changes.join('; ')}`);
    if (!!prev.verboseLogging !== !!next.verboseLogging) {
      setDebugLogging(!!next.verboseLogging || !!process.env.TL_DEBUG);
      this.scheduleDiagStatus(true);
    }
    if (JSON.stringify(prev.hotkeys) !== JSON.stringify(next.hotkeys)) this.applyHotkeys(next);
    if (prev.launchOnStartup !== next.launchOnStartup) this.applyLoginItem(next);
    if ((prev.hearthstonePath ?? '') !== (next.hearthstonePath ?? '')) void this.discover();
    if (!prev.communityStats && next.communityStats) {
      this.community.prefetch();
      this.communityTrinkets.prefetch();
    }
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
    log.info(`hotkey ${action}`);
    if (action === 'toggleOverlay') {
      this.setSettings({ overlayEnabled: !this.store.getSettings().overlayEnabled });
      return;
    }
    const widget: WidgetId = 'opponentsPanel';
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
      log.info(`Hearthstone found at ${install}${override ? ' (folder set in settings)' : ''}`);
      this.hsNotFoundLogged = false;
    } else {
      if (!this.hsNotFoundLogged) {
        log.info(`Hearthstone installation not found${override ? ` (settings folder ${override} is not one)` : ''}; retrying every ${DISCOVERY_RETRY_MS / 1000} s`);
        this.hsNotFoundLogged = true;
      }
      if (this.windowTracker.supported) this.status.addError(HS_NOT_FOUND);
      this.discoveryTimer = setTimeout(() => void this.discover(), DISCOVERY_RETRY_MS);
    }
    if (!this.tailer) {
      this.tailer = new LogTailer({
        resolvePath: () => (this.logsDir ? resolvePowerLog(this.logsDir)?.path : undefined),
        onLines: (lines) => this.live.feed(lines),
        onFileChange: ({ path, reason, startOffset }) => {
          log.info(`Power.log ${reason === 'initial' ? 'selected' : reason}: ${path ?? '(none)'} from byte ${startOffset}`);
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
    log.info(`log.config fix requested: ${result} (${logConfigPath() ?? 'no known location'})`);
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
    this.logGameWindow(info);
    this.status.update({ gameWindow: info });
    this.updateOverlay();
  }

  /** Found / focused / minimized changes are logged at once; moves and resizes once they settle. */
  private logGameWindow(info: GameWindowInfo): void {
    const prev = this.loggedWindow;
    const flags = (w: GameWindowInfo) => `${w.found}/${w.focused}/${w.minimized}`;
    const rect = (w: GameWindowInfo | undefined) => JSON.stringify(w?.bounds ?? null);
    if (!prev || flags(prev) !== flags(info)) {
      if (this.windowLogTimer) clearTimeout(this.windowLogTimer);
      this.windowLogTimer = undefined;
      this.loggedWindow = info;
      log.info(`game window: ${describeWindow(info)}`);
      return;
    }
    if (rect(prev) === rect(info)) return;
    if (this.windowLogTimer) clearTimeout(this.windowLogTimer);
    this.windowLogTimer = setTimeout(() => {
      this.windowLogTimer = undefined;
      const cur = this.windowTracker.info;
      if (rect(this.loggedWindow) === rect(cur)) return;
      this.loggedWindow = cur;
      log.info(`game window moved/resized: ${describeWindow(cur)}`);
    }, 1000);
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
    rendererLogs.drain((id) => this.windowNameById(id));
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
    this.recordSimCases('live', events);
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
    const liveId = this.liveGameId || this.live.getState().gameId;
    const demoId = this.demoGameId || this.demoFeed?.getState().gameId || '';
    // Results come by turn only. A run started for one feed can finish just after the demo
    // started or stopped: give it to the feed that has an open combat on that turn.
    const open = (id: string) => {
      const c = id ? this.simCases?.peek(id, turn) : undefined;
      return !!c?.input && !c.result;
    };
    let source: 'live' | 'demo' = this.demoActive ? 'demo' : 'live';
    if (source === 'demo' && !open(demoId) && open(liveId)) source = 'live';
    else if (source === 'live' && !open(liveId) && open(demoId)) source = 'demo';
    simLog.info(`sim t${turn} (${source}): ${describeSim(result)}`);
    const gameId = source === 'demo' ? demoId : liveId;
    if (gameId && this.simCases) this.logVerdict(this.simCases.simResult(gameId, turn, result, source));
    if (source === 'demo') return; // demo games are never saved
    this.predictions.set(turn, result);
  }

  // ------------------------------------------------------------- diagnostics

  /** Feeds combats into the simulator case log and counts overlay interactivity per game. */
  private recordSimCases(source: 'live' | 'demo', events: BgEvent[]): void {
    const cases = this.simCases;
    for (const e of events) {
      try {
        if (e.type === 'gameStart') {
          if (source === 'live') this.liveGameId = e.gameId;
          else this.demoGameId = e.gameId;
          this.interactiveToggles = 0;
          continue;
        }
        const feed = source === 'live' ? this.live : this.demoFeed;
        const gameId = (source === 'live' ? this.liveGameId : this.demoGameId) || feed?.getState().gameId || '';
        if (e.type === 'combatStart') {
          if (gameId) cases?.combatStart(gameId, e.turn, e.input, source);
        } else if (e.type === 'combatEnd') {
          const actual = { result: e.record.result, damage: e.record.damage, opponentHeroCardId: e.record.opponentHeroCardId };
          if (gameId && cases) this.logVerdict(cases.combatEnd(gameId, e.turn, actual, source));
        } else if (e.type === 'gameEnd') {
          log.info(`overlay interactivity this game: ${this.interactiveToggles} switches between click-through and interactive`);
          if (gameId) cases?.endGame(gameId);
        }
      } catch (err) {
        simLog.warn('sim case bookkeeping failed', err);
      }
    }
  }

  private logVerdict(c: SimCase): void {
    if (!c.verdict || !c.actual || this.verdictsLogged.has(c.key)) return;
    this.verdictsLogged.add(c.key);
    if (this.verdictsLogged.size > 500) this.verdictsLogged.delete(this.verdictsLogged.values().next().value!);
    const a = c.actual;
    const line = `sim t${c.turn} (${c.source}) vs actual ${a.result}${a.result === 'tied' ? '' : ` ${a.damage}`}: ${describeVerdict(c.verdict)}`;
    if (c.verdict.surprise) simLog.warn(`${line} · case ${c.key} in sim-cases.jsonl`);
    else simLog.info(line);
  }

  private diagStatus(): DiagnosticsStatus {
    const st = getLogStats();
    return {
      logsDir: this.appLogsDir,
      logFile: logFilePath(),
      verbose: isDebugLogging(),
      errorCount: st.errors,
      warnCount: st.warnings,
      recentErrors: st.recentErrors.slice(-5),
    };
  }

  private scheduleDiagStatus(now = false): void {
    if (now) {
      if (this.diagStatusTimer) clearTimeout(this.diagStatusTimer);
      this.diagStatusTimer = undefined;
      this.status?.update({ diagnostics: this.diagStatus() });
      return;
    }
    if (this.diagStatusTimer) return;
    this.diagStatusTimer = setTimeout(() => {
      this.diagStatusTimer = undefined;
      this.status?.update({ diagnostics: this.diagStatus() });
    }, 1000);
  }

  private writeSessionHeader(): void {
    if (this.headerWritten) return;
    this.headerWritten = true;
    try {
      const st = this.status.get();
      const s = this.store.getSettings();
      const { positions: _p, ...settings } = s;
      void _p;
      const cd = st.cardData;
      const header = sessionHeader(systemInfo(), {
        hearthstoneInstall: st.hearthstoneInstallPath,
        logsDir: this.logsDir,
        powerLog: st.powerLogPath ?? (this.logsDir ? resolvePowerLog(this.logsDir)?.path : undefined),
        logConfig: st.logConfig,
        logConfigPath: logConfigPath(),
        cardData: `build ${cd.build}${cd.patch ? ` (patch ${cd.patch})` : ''} · ${cd.source} · ${cd.cards} cards`,
        settings: { ...settings, positions: Object.keys(s.positions ?? {}) },
        logFile: logFilePath(),
        verbose: isDebugLogging(),
      });
      createLogger('session').info(header);
    } catch (err) {
      diagLog.warn('could not write the session header', err);
    }
  }

  private windowName(wc: WebContents): string {
    return this.windowNameById(wc.id);
  }

  private windowNameById(id: number): string {
    const isWin = (w: BrowserWindow | undefined) => !!w && !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.id === id;
    return isWin(this.overlay) ? 'overlay' : isWin(this.settingsWin) ? 'companion' : `window${id}`;
  }

  private exportCandidates(): Array<string | undefined> {
    const path = (name: 'desktop' | 'downloads' | 'userData') => {
      try {
        return app.getPath(name);
      } catch {
        return undefined;
      }
    };
    const devDir = isDev() ? process.env.TL_EXPORT_DIR : undefined;
    return [devDir, path('desktop'), path('downloads'), path('userData')];
  }

  async exportDiagnostics(opts: DiagnosticsExportOptions, reveal = true): Promise<DiagnosticsExportResult> {
    if (this.exporting) return { ok: false, error: 'An export is already running.' };
    this.exporting = true;
    try {
      const includeGameLogs = opts.includeGameLogs !== false;
      if ((this.store.getSettings().exportIncludeGameLogs !== false) !== includeGameLogs) {
        this.setSettings({ exportIncludeGameLogs: includeGameLogs });
      }
      const outDir = pickExportDir(this.exportCandidates());
      if (!outDir) throw new Error('No writable folder for the export (Desktop, Downloads or the app folder).');
      diagLog.info(`exporting diagnostics to ${outDir} (Hearthstone game logs ${includeGameLogs ? 'included' : 'not included'})`);
      const status: AppStatus = { ...this.status.get(), diagnostics: this.diagStatus() };
      let system: unknown;
      try {
        system = { ...systemInfo(), paths: { userData: app.getPath('userData'), logs: this.appLogsDir, exe: app.getPath('exe') } };
      } catch (err) {
        system = { error: String(err) };
      }
      const res = await writeDiagnosticsZip({
        outDir,
        now: new Date(),
        appVersion: app.getVersion(),
        appLogsDir: this.appLogsDir,
        simCases: this.simCases?.snapshot() ?? '',
        settings: this.store.getSettings(),
        history: this.store.getHistory(),
        status,
        system,
        includeGameLogs,
        game: { logsDir: this.logsDir, logConfigPath: logConfigPath() },
      });
      this.exportedPaths.add(res.path);
      diagLog.info(
        `diagnostics exported: ${res.path} (${Math.round(res.bytes / 1024)} KB, ${res.files.length} files)` +
          (res.notes.length ? `; notes: ${res.notes.join('; ')}` : ''),
      );
      if (reveal) shell.showItemInFolder(res.path);
      return { ok: true, path: res.path, bytes: res.bytes, files: res.files, notes: res.notes };
    } catch (err) {
      diagLog.error('diagnostics export failed', err);
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    } finally {
      this.exporting = false;
    }
  }

  private async openLogsFolder(): Promise<void> {
    const err = await shell.openPath(this.appLogsDir);
    if (err) diagLog.warn(`could not open the logs folder ${this.appLogsDir}: ${err}`);
  }

  private showItemInFolder(path: string): void {
    // Only files this app exported (the renderer must not reveal arbitrary paths).
    if (!this.exportedPaths.has(path)) {
      diagLog.warn(`showItemInFolder refused for a path that was not exported: ${path}`);
      return;
    }
    shell.showItemInFolder(path);
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

  private async getTrinketStats(): Promise<TrinketStatsBundle[]> {
    const bundles = personalTrinketBundles(this.store.getHistory());
    if (this.store.getSettings().communityStats) {
      try {
        bundles.push(...(await this.communityTrinkets.getBundles()));
      } catch (err) {
        log.warn('community trinket stats failed', err);
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
      logTransitions: !!process.env.TL_DEBUG,
      cardName: (id) => this.cardData.current.get(id)?.name,
      onState: (st) => {
        if (this.demoActive) this.broadcast(IPC.state, st);
      },
      onEvents: (events) => {
        this.recordSimCases('demo', events);
        if (this.demoActive) for (const e of events) this.broadcast(IPC.event, e);
      },
    });
    log.info(`demo started at ${s}x`);
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
      if (this.windowLogTimer) clearTimeout(this.windowLogTimer);
      this.simCases?.flushAll();
      this.simCases?.dispose();
      this.store.settingsFile.writeSync(this.store.getSettings());
      this.store.historyFile.writeSync(this.store.getHistory());
      this.tray?.destroy();
    } catch (err) {
      log.error('shutdown error', err);
    }
  }
}
