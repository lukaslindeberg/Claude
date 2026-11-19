/**
 * Preload (sandboxed, context-isolated): exposes `window.tavernLens`, an
 * implementation of `TavernLensBridge` backed by IPC. Bundled to CommonJS
 * (out/preload/index.cjs) because sandboxed preloads cannot be ES modules.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from '@shared/ipc';
import type { TavernLensBridge, Unsubscribe } from '@shared/ipc';
import type {
  AppStatus,
  BattleSimResult,
  BgCardData,
  BgEvent,
  BgGameState,
  DiagnosticsExportOptions,
  DiagnosticsExportResult,
  HeroStatsBundle,
  LogLevel,
  MatchRecord,
  Settings,
  TrinketStatsBundle,
  CompGuidesBundle,
  WidgetId,
} from '@shared/types';

function windowKindFromArgv(argv: string[]): TavernLensBridge['windowKind'] {
  const arg = argv.find((a) => a.startsWith('--tl-window='));
  return arg?.slice('--tl-window='.length) === 'overlay' ? 'overlay' : 'settings';
}

function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void): Unsubscribe => {
    const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const bridge: TavernLensBridge = {
  windowKind: windowKindFromArgv(process.argv),

  onState: subscribe<BgGameState>(IPC.state),
  onEvent: subscribe<BgEvent>(IPC.event),
  onStatus: subscribe<AppStatus>(IPC.status),
  onSettings: subscribe<Settings>(IPC.settingsChanged),
  onHistory: subscribe<MatchRecord[]>(IPC.historyChanged),
  onToggleWidget: subscribe<WidgetId>(IPC.toggleWidget),

  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<BgGameState>,
  getStatus: () => ipcRenderer.invoke(IPC.getStatus) as Promise<AppStatus>,
  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<Settings>,
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.setSettings, patch) as Promise<Settings>,
  getHistory: () => ipcRenderer.invoke(IPC.getHistory) as Promise<MatchRecord[]>,
  clearHistory: () => ipcRenderer.invoke(IPC.clearHistory) as Promise<void>,
  getCardData: () => ipcRenderer.invoke(IPC.getCardData) as Promise<BgCardData>,
  getHeroStats: () => ipcRenderer.invoke(IPC.getHeroStats) as Promise<HeroStatsBundle[]>,
  getTrinketStats: () => ipcRenderer.invoke(IPC.getTrinketStats) as Promise<TrinketStatsBundle[]>,
  getCompGuides: () => ipcRenderer.invoke(IPC.getCompGuides) as Promise<CompGuidesBundle | undefined>,
  reportSimResult: (turn: number, result: BattleSimResult) =>
    ipcRenderer.invoke(IPC.reportSimResult, turn, result) as Promise<void>,
  startDemo: (speed?: number) => ipcRenderer.invoke(IPC.startDemo, speed) as Promise<void>,
  stopDemo: () => ipcRenderer.invoke(IPC.stopDemo) as Promise<void>,
  pickHearthstonePath: () => ipcRenderer.invoke(IPC.pickHearthstonePath) as Promise<string | undefined>,
  fixLogConfig: () => ipcRenderer.invoke(IPC.fixLogConfig) as Promise<AppStatus['logConfig']>,
  exportDiagnostics: (opts?: DiagnosticsExportOptions) =>
    ipcRenderer.invoke(IPC.exportDiagnostics, opts ?? {}) as Promise<DiagnosticsExportResult>,
  openLogsFolder: () => ipcRenderer.invoke(IPC.openLogsFolder) as Promise<void>,
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates) as Promise<void>,
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate) as Promise<void>,

  setInteractive: (interactive: boolean) => ipcRenderer.send(IPC.setInteractive, !!interactive),
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  openExternal: (url: string) => ipcRenderer.send(IPC.openExternal, url),
  quit: () => ipcRenderer.send(IPC.quit),
  logEvent: (level: LogLevel, scope: string, message: string, data?: unknown) => {
    try {
      ipcRenderer.send(IPC.logEvent, level, scope, message, data);
    } catch {
      // Not structured-cloneable: send a string rendering instead.
      ipcRenderer.send(IPC.logEvent, level, scope, message, data === undefined ? undefined : String(data));
    }
  },
  showItemInFolder: (path: string) => ipcRenderer.send(IPC.showItemInFolder, path),
};

contextBridge.exposeInMainWorld('tavernLens', bridge);
