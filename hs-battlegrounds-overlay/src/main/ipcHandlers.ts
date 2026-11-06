/**
 * Registers every renderer -> main handler declared in `src/shared/ipc.ts`.
 */
import { ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { IPC } from '@shared/ipc';
import type {
  AppStatus,
  BattleSimResult,
  BgCardData,
  BgGameState,
  HeroStatsBundle,
  MatchRecord,
  Settings,
} from '@shared/types';
import { createLogger } from './logger';

const log = createLogger('ipc');

export interface IpcBackend {
  getState(): BgGameState;
  getStatus(): AppStatus;
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): Settings;
  getHistory(): MatchRecord[];
  clearHistory(): void;
  getCardData(): BgCardData;
  getHeroStats(): Promise<HeroStatsBundle[]>;
  reportSimResult(turn: number, result: BattleSimResult): void;
  startDemo(speed?: number): Promise<void>;
  stopDemo(): void;
  pickHearthstonePath(sender: WebContents): Promise<string | undefined>;
  fixLogConfig(): Promise<AppStatus['logConfig']>;
  setInteractive(sender: WebContents, interactive: boolean): void;
  openSettings(): void;
  openExternal(url: string): void;
  quit(): void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function handle<T>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => T | Promise<T>): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await fn(e, ...args);
    } catch (err) {
      log.error(`${channel} failed`, err);
      throw err;
    }
  });
}

function on(channel: string, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void {
  ipcMain.removeAllListeners(channel);
  ipcMain.on(channel, (e, ...args) => {
    try {
      fn(e, ...args);
    } catch (err) {
      log.error(`${channel} failed`, err);
    }
  });
}

export function registerIpcHandlers(b: IpcBackend): void {
  handle(IPC.getState, () => b.getState());
  handle(IPC.getStatus, () => b.getStatus());
  handle(IPC.getSettings, () => b.getSettings());
  handle(IPC.setSettings, (_e, patch) => {
    if (!isObject(patch)) throw new Error('setSettings expects an object');
    return b.setSettings(patch as Partial<Settings>);
  });
  handle(IPC.getHistory, () => b.getHistory());
  handle(IPC.clearHistory, () => b.clearHistory());
  handle(IPC.getCardData, () => b.getCardData());
  handle(IPC.getHeroStats, () => b.getHeroStats());
  handle(IPC.reportSimResult, (_e, turn, result) => {
    if (typeof turn !== 'number' || !Number.isFinite(turn) || !isObject(result)) return;
    b.reportSimResult(turn, result as unknown as BattleSimResult);
  });
  handle(IPC.startDemo, (_e, speed) => b.startDemo(typeof speed === 'number' ? speed : undefined));
  handle(IPC.stopDemo, () => b.stopDemo());
  handle(IPC.pickHearthstonePath, (e) => b.pickHearthstonePath(e.sender));
  handle(IPC.fixLogConfig, () => b.fixLogConfig());

  on(IPC.setInteractive, (e, interactive) => b.setInteractive(e.sender, !!interactive));
  on(IPC.openSettings, () => b.openSettings());
  on(IPC.openExternal, (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) b.openExternal(url);
  });
  on(IPC.quit, () => b.quit());
}
