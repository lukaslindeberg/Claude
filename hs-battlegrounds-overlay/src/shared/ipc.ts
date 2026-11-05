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
  HeroStatsBundle,
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
  reportSimResult: 'tl:report-sim-result',
  startDemo: 'tl:start-demo',
  stopDemo: 'tl:stop-demo',
  pickHearthstonePath: 'tl:pick-hs-path',
  fixLogConfig: 'tl:fix-log-config',
  // renderer -> main (send)
  setInteractive: 'tl:set-interactive',
  openSettings: 'tl:open-settings',
  openExternal: 'tl:open-external',
  quit: 'tl:quit',
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
  /** The overlay runs the simulator in a worker and reports results so they are saved with the match. */
  reportSimResult(turn: number, result: BattleSimResult): Promise<void>;
  startDemo(speed?: number): Promise<void>;
  stopDemo(): Promise<void>;
  pickHearthstonePath(): Promise<string | undefined>;
  fixLogConfig(): Promise<AppStatus['logConfig']>;

  /** Overlay only: make the window capture the mouse (true) or be click-through (false). */
  setInteractive(interactive: boolean): void;
  openSettings(): void;
  openExternal(url: string): void;
  quit(): void;
}

declare global {
  interface Window {
    tavernLens: TavernLensBridge;
  }
}
