import { create } from 'zustand';
import { CardDb } from '@core/cards/cardDb';
import {
  DEFAULT_SETTINGS,
  type AppStatus,
  type BattleSimResult,
  type BgEvent,
  type BgGameState,
  type HeroStatsBundle,
  type MatchRecord,
  type Settings,
  type WidgetId,
} from '@shared/types';
import type { TavernLensBridge } from '@shared/ipc';

/**
 * UI-only settings extension. `leaderboardCalibrationMode` is not (yet) part of
 * the shared Settings contract; it is passed through setSettings so both
 * windows see it, and treated as false when absent.
 */
export type UiSettings = Settings & { leaderboardCalibrationMode?: boolean };

export interface SimRun {
  /** gameId:turn key of the battle input this run belongs to. */
  key: string;
  turn: number;
  status: 'running' | 'done' | 'error';
  result?: BattleSimResult;
  error?: string;
  startedAt: number;
}

export interface AppStore {
  bridge: TavernLensBridge | null;
  /** True when running in a plain browser with the mock bridge. */
  demo: boolean;
  ready: boolean;
  cardDb: CardDb;
  game: BgGameState | null;
  status: AppStatus | null;
  settings: UiSettings;
  history: MatchRecord[];
  heroStats: HeroStatsBundle[];
  events: BgEvent[];
  /** Overlay: simulator runs by key. */
  sims: Record<string, SimRun>;
  /** Overlay: widgets hidden via hotkey for this session. */
  hidden: Partial<Record<WidgetId, boolean>>;
  /** Overlay: widget "toggle" pulses from hotkeys (counter per widget). */
  togglePulse: Partial<Record<WidgetId, number>>;
  /** Overlay: dismissed post-match summary for this gameId. */
  dismissedPostMatch?: string;

  updateSettings(patch: Partial<UiSettings>): Promise<void>;
  setSim(run: SimRun): void;
  dismissPostMatch(gameId: string): void;
}

export const useApp = create<AppStore>((set, get) => ({
  bridge: null,
  demo: false,
  ready: false,
  cardDb: CardDb.bundled(),
  game: null,
  status: null,
  settings: DEFAULT_SETTINGS,
  history: [],
  heroStats: [],
  events: [],
  sims: {},
  hidden: {},
  togglePulse: {},

  async updateSettings(patch) {
    const { bridge, settings } = get();
    set({ settings: { ...settings, ...patch } });
    if (!bridge) return;
    try {
      const next = await bridge.setSettings(patch as Partial<Settings>);
      // Keep UI-only fields the main process may not echo back.
      const merged: UiSettings = { ...get().settings, ...next };
      set({ settings: merged });
    } catch (err) {
      console.error('[tavern-lens] setSettings failed', err);
    }
  },

  setSim(run) {
    set((s) => ({ sims: { ...s.sims, [run.key]: run } }));
  },

  dismissPostMatch(gameId) {
    set({ dismissedPostMatch: gameId });
  },
}));

/** Subscribe the store to a bridge. Returns an unsubscribe function. */
export async function connectStore(bridge: TavernLensBridge, demo: boolean): Promise<() => void> {
  useApp.setState({ bridge, demo });
  const subs = [
    bridge.onState((game) => useApp.setState({ game })),
    bridge.onStatus((status) => useApp.setState({ status })),
    bridge.onSettings((settings) => useApp.setState((s) => ({ settings: { ...s.settings, ...settings } }))),
    bridge.onHistory((history) => useApp.setState({ history })),
    bridge.onEvent((ev) => useApp.setState((s) => ({ events: [...s.events.slice(-49), ev] }))),
    bridge.onToggleWidget((w) =>
      useApp.setState((s) => ({ togglePulse: { ...s.togglePulse, [w]: (s.togglePulse[w] ?? 0) + 1 } })),
    ),
  ];

  const settled = await Promise.allSettled([
    bridge.getSettings(),
    bridge.getState(),
    bridge.getStatus(),
    bridge.getHistory(),
    bridge.getHeroStats(),
  ]);
  const [settings, game, status, history, heroStats] = settled.map((r) =>
    r.status === 'fulfilled' ? r.value : undefined,
  ) as [Settings?, BgGameState?, AppStatus?, MatchRecord[]?, HeroStatsBundle[]?];
  useApp.setState((s) => ({
    settings: settings ? { ...DEFAULT_SETTINGS, ...s.settings, ...settings } : s.settings,
    game: game ?? s.game,
    status: status ?? s.status,
    history: history ?? s.history,
    heroStats: heroStats ?? s.heroStats,
    ready: true,
  }));

  // Fresher card data from the main process (runtime-refreshed), if newer than bundled.
  bridge
    .getCardData()
    .then((data) => {
      if (data && data.cards?.length && data.build > useApp.getState().cardDb.build) {
        useApp.setState({ cardDb: new CardDb(data) });
      }
    })
    .catch(() => undefined);

  return () => subs.forEach((u) => u());
}

/** Refresh hero stats (e.g. when history or community setting changes). */
export async function refreshHeroStats(): Promise<void> {
  const { bridge } = useApp.getState();
  if (!bridge) return;
  try {
    useApp.setState({ heroStats: await bridge.getHeroStats() });
  } catch {
    /* ignore */
  }
}
