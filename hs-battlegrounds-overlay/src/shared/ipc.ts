/**
 * IPC contract between the Electron main process and renderer windows.
 * The preload script exposes an object implementing `TavernLensBridge` as
 * `window.tavernLens`. The renderer must only use this bridge (no Node access).
 *
 * In the browser demo (no Electron) the renderer installs a mock bridge that
 * implements the same interface (see src/renderer/src/bridge).
 */
import type {
  AppStatus,
  BattleSimResult,
  BgCardData,
  BgEvent,
  BgGameState,
  DiagnosticsExportOptions,
  DiagnosticsExportResult,
  HeroStatsBundle,
  TrinketStatsBundle,
  CompGuidesBundle,
  LogLevel,
  MatchRecord,
  Settings,
  WidgetId,
} from './types';

export const IPC = {
  // main -> renderer (push)
  state: 'tl:state',
  event: 'tl:event',
  status: 'tl:status',
  settingsChanged: 'tl:settings-changed',
  historyChanged: 'tl:history-changed',
  toggleWidget: 'tl:toggle-widget',
  // renderer -> main (invoke)
  getState: 'tl:get-state',
  getStatus: 'tl:get-status',
  getSettings: 'tl:get-settings',
  setSettings: 'tl:set-settings',
  getHistory: 'tl:get-history',
  clearHistory: 'tl:clear-history',
  getCardData: 'tl:get-card-data',
  getHeroStats: 'tl:get-hero-stats',
  getTrinketStats: 'tl:get-trinket-stats',
  getCompGuides: 'tl:get-comp-guides',
  reportSimResult: 'tl:report-sim-result',
  startDemo: 'tl:start-demo',
  stopDemo: 'tl:stop-demo',
  pickHearthstonePath: 'tl:pick-hs-path',
  fixLogConfig: 'tl:fix-log-config',
  exportDiagnostics: 'tl:export-diagnostics',
  openLogsFolder: 'tl:open-logs-folder',
  checkForUpdates: 'tl:check-for-updates',
  installUpdate: 'tl:install-update',
  // renderer -> main (send)
  setInteractive: 'tl:set-interactive',
  openSettings: 'tl:open-settings',
  openExternal: 'tl:open-external',
  quit: 'tl:quit',
  logEvent: 'tl:log-event',
  showItemInFolder: 'tl:show-item-in-folder',
} as const;

export type Unsubscribe = () => void;

export interface TavernLensBridge {
  /** Which window this renderer is: the transparent overlay or the settings/companion window. */
  readonly windowKind: 'overlay' | 'settings';

  onState(cb: (state: BgGameState) => void): Unsubscribe;
  onEvent(cb: (event: BgEvent) => void): Unsubscribe;
  onStatus(cb: (status: AppStatus) => void): Unsubscribe;
  onSettings(cb: (settings: Settings) => void): Unsubscribe;
  onHistory(cb: (history: MatchRecord[]) => void): Unsubscribe;
  /** Hotkey pressed in main process: toggle a widget's expanded/visible state. */
  onToggleWidget(cb: (widget: WidgetId) => void): Unsubscribe;

  getState(): Promise<BgGameState>;
  getStatus(): Promise<AppStatus>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getHistory(): Promise<MatchRecord[]>;
  clearHistory(): Promise<void>;
  /** Freshest card data available (runtime-refreshed or bundled). */
  getCardData(): Promise<BgCardData>;
  /** Personal + (optional) community hero stats. */
  getHeroStats(): Promise<HeroStatsBundle[]>;
  /** Personal + (optional) community trinket stats. */
  getTrinketStats(): Promise<TrinketStatsBundle[]>;
  /** Community comp guides (undefined when community stats are off or unavailable). */
  getCompGuides(): Promise<CompGuidesBundle | undefined>;
  /** The overlay runs the simulator in a worker and reports results so they are saved with the match. */
  reportSimResult(turn: number, result: BattleSimResult): Promise<void>;
  startDemo(speed?: number): Promise<void>;
  stopDemo(): Promise<void>;
  pickHearthstonePath(): Promise<string | undefined>;
  fixLogConfig(): Promise<AppStatus['logConfig']>;
  /** Writes `TavernLens-diagnostics-*.zip` (Desktop, else Downloads) and reveals it. */
  exportDiagnostics(opts?: DiagnosticsExportOptions): Promise<DiagnosticsExportResult>;
  /** Opens the folder with the app's log files. */
  openLogsFolder(): Promise<void>;
  /** Checks the release channel now; the result arrives as `AppStatus.update`. */
  checkForUpdates(): Promise<void>;
  /** Installs a downloaded update (restarts the app) or opens the download page. */
  installUpdate(): Promise<void>;

  /** Overlay only: make the window capture the mouse (true) or be click-through (false). */
  setInteractive(interactive: boolean): void;
  openSettings(): void;
  openExternal(url: string): void;
  quit(): void;
  /**
   * Writes an entry to the main-process diagnostics log (renderer errors, simulator
   * worker failures). Rate-limited by the main process (~50 per minute per window).
   */
  logEvent(level: LogLevel, scope: string, message: string, data?: unknown): void;
  /** Reveals a file this app exported (a diagnostics zip) in Explorer / Finder. */
  showItemInFolder(path: string): void;
}

declare global {
  interface Window {
    tavernLens: TavernLensBridge;
  }
}
