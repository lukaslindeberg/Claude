/**
 * Mock implementation of the preload bridge for browser development, the
 * `vite.demo.config.ts` demo server and screenshots.
 *
 * Scenes (URL `?scene=`): heroSelection | trinketPick | recruit | combat | gameOver | idle | replay
 * `?scene=heroSelection&tribes=inferred` shows hero selection with the lobby's tribes known.
 * `&mode=duos` turns the recruit / combat / gameOver scenes into a Duos lobby (four teams).
 */
import type { TavernLensBridge, Unsubscribe } from '@shared/ipc';
import {
  DEFAULT_SETTINGS,
  type AppStatus,
  type BattleSimResult,
  type BgEvent,
  type BgGameState,
  type HeroStatsBundle,
  type MatchRecord,
  type TrinketStatsBundle,
  type Settings,
  type WidgetId,
} from '@shared/types';
import { CardDb } from '@core/cards/cardDb';
import { attachMatchedStats, bundledCompGuides } from '@core/stats/comps';
import * as samples from '../dev/samples';
import { personalBundle } from '../lib/stats';
import { personalTrinketBundle } from '../lib/synergy';

type Listener<T> = (v: T) => void;

class Emitter<T> {
  private ls = new Set<Listener<T>>();
  on(cb: Listener<T>): Unsubscribe {
    this.ls.add(cb);
    return () => this.ls.delete(cb);
  }
  emit(v: T) {
    for (const l of this.ls) l(v);
  }
}

export interface MockOptions {
  windowKind: 'overlay' | 'settings';
  scene: string;
  speed?: number;
}

const SETTINGS_KEY = 'tavern-lens-demo-settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function sceneState(scene: string): BgGameState {
  let s = sceneStateBase(scene);
  // `&mode=duos`: the same lobby as four teams of two (recruit, combat, gameOver).
  if (new URLSearchParams(window.location.search).get('mode') === 'duos' && s.active && s.players.length) s = samples.duosState(s);
  if (new URLSearchParams(window.location.search).get('counters') === 'all' && s.active) s.counters = { ...samples.ALL_COUNTERS };
  // `&tribes=screen`: the lobby's tribes as read from the hero-pick screen.
  if (new URLSearchParams(window.location.search).get('tribes') === 'screen' && s.active)
    s = { ...s, availableTribes: ['BEAST', 'DEMON', 'DRAGON', 'PIRATE', 'QUILBOAR'], tribesSource: 'screen' };
  return s;
}

function sceneStateBase(scene: string): BgGameState {
  switch (scene) {
    case 'heroSelection': {
      const s = samples.heroSelectionState();
      if (new URLSearchParams(window.location.search).get('tribes') === 'inferred') {
        s.availableTribes = ['ABERRATION', 'BEAST', 'MECHANICAL', 'NAGA', 'UNDEAD'];
        s.tribesSource = 'inferred';
      }
      return s;
    }
    case 'trinketPick':
      return samples.trinketPickState();
    case 'combat': {
      // `&sim=ok|unreliable`: a fixed result instead of running the simulator (screenshots).
      const sim = new URLSearchParams(window.location.search).get('sim');
      const s = samples.combatState();
      if (sim === 'ok' || sim === 'unreliable') {
        s.battle = {
          status: 'done',
          turn: s.battle.turn,
          result: { ...samples.SAMPLE_SIM_RESULT, ...(sim === 'ok' ? { unsupported: [] } : { win: 96.8, tie: 1.4, loss: 1.8, avgDamageDealt: 11.2, avgDamageTaken: 3.1, unsupported: ['BG36_102', 'BGDUO_112', 'BG36_511'] }) },
        };
      }
      return s;
    }
    case 'gameOver':
      return samples.gameOverState();
    case 'idle':
    case 'replay':
      return samples.idleState();
    default:
      return samples.recruitState();
  }
}

export function createMockBridge(opts: MockOptions): TavernLensBridge {
  const params = new URLSearchParams(window.location.search);
  const stateE = new Emitter<BgGameState>();
  const eventE = new Emitter<BgEvent>();
  const statusE = new Emitter<AppStatus>();
  const settingsE = new Emitter<Settings>();
  const historyE = new Emitter<MatchRecord[]>();
  const toggleE = new Emitter<WidgetId>();

  let state = sceneState(opts.scene);
  let status: AppStatus = {
    ...samples.sampleStatus(),
    diagnostics: {
      logsDir: 'C:\\Users\\you\\AppData\\Roaming\\Tavern Lens\\logs',
      logFile: 'C:\\Users\\you\\AppData\\Roaming\\Tavern Lens\\logs\\tavern-lens.log',
      verbose: false,
      errorCount: 0,
      warnCount: 0,
      recentErrors: [],
    },
  };
  let settings = loadSettings();
  // Demo URL overrides (handy for screenshots).
  if (params.get('images') === '0') settings.cardImages = false;
  if (params.get('scale')) settings.scale = Number(params.get('scale')) || 1;
  let history = params.get('history') === '0' ? [] : samples.sampleHistory();
  if (opts.scene === 'gameOver') history = [gameOverRecord(state), ...history];

  // Keep settings in sync across demo tabs (overlay tab + companion tab).
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel('tavern-lens-demo');
    channel.onmessage = (e) => {
      if (e.data?.type === 'settings') {
        settings = e.data.settings;
        settingsE.emit(settings);
      }
    };
  } catch {
    /* ignore */
  }

  const setState = (next: BgGameState) => {
    state = next;
    stateE.emit(state);
  };

  // Combat scene: reveal the actual result after a few seconds.
  if (opts.scene === 'combat' && params.get('actual') !== '0') {
    const delay = Number(params.get('actualDelay') ?? 5000);
    setTimeout(() => {
      const battle = { ...state.battle, actual: { result: 'won' as const, damage: 9 } };
      setState({ ...state, battle });
    }, delay);
  }

  let stopReplay: (() => void) | undefined;
  const startReplay = async (speed?: number) => {
    stopReplay?.();
    const { runReplay, parseUntil } = await import('../dev/replay');
    status = { ...status, demo: { running: true, progress: 0, speed: speed ?? 40 } };
    statusE.emit(status);
    // `?log=bg_duos_trinkets_206605` replays another fixture from test/fixtures/logs.
    const log = params.get('log');
    stopReplay = runReplay({
      cardDb: CardDb.bundled(),
      url: log && /^[\w.-]+$/.test(log) ? `/__fixtures/logs/${log}.power.log.gz` : undefined,
      speed: speed ?? opts.speed ?? 40,
      until: parseUntil(params.get('until')),
      onState: (s) => setState(s),
      onEvent: (ev) => {
        eventE.emit(ev);
        if (ev.type === 'gameEnd') {
          history = [ev.record, ...history];
          historyE.emit(history);
        }
      },
      onProgress: (progress) => {
        status = { ...status, demo: { ...status.demo, running: progress < 1, progress } };
        statusE.emit(status);
      },
      onError: (err) => {
        status = { ...status, demo: { running: false }, errors: [...status.errors, `Replay failed: ${err}`] };
        statusE.emit(status);
      },
    });
  };
  if (opts.scene === 'replay') setTimeout(() => void startReplay(opts.speed), 50);

  const bridge: TavernLensBridge = {
    windowKind: opts.windowKind,
    onState: (cb) => stateE.on(cb),
    onEvent: (cb) => eventE.on(cb),
    onStatus: (cb) => statusE.on(cb),
    onSettings: (cb) => settingsE.on(cb),
    onHistory: (cb) => historyE.on(cb),
    onToggleWidget: (cb) => toggleE.on(cb),

    getState: async () => state,
    getStatus: async () => status,
    getSettings: async () => settings,
    async setSettings(patch) {
      settings = { ...settings, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        /* ignore */
      }
      settingsE.emit(settings);
      channel?.postMessage({ type: 'settings', settings });
      return settings;
    },
    getHistory: async () => history,
    async clearHistory() {
      history = [];
      historyE.emit(history);
    },
    getCardData: async () => CardDb.bundled().data,
    async getHeroStats(): Promise<HeroStatsBundle[]> {
      const bundles = [personalBundle(history)];
      if (settings.communityStats) bundles.unshift(samples.communityStats());
      return bundles;
    },
    async getTrinketStats(): Promise<TrinketStatsBundle[]> {
      const bundles = [personalTrinketBundle(history)];
      if (settings.communityStats) bundles.unshift(samples.communityTrinketStats());
      return bundles;
    },
    async getCompGuides() {
      const bundle = bundledCompGuides();
      if (settings.communityStats) attachMatchedStats(bundle.comps, samples.compGuides().comps);
      return bundle;
    },
    async reportSimResult(turn: number, result: BattleSimResult) {
      console.info(`[mock bridge] sim result for turn ${turn}`, result);
    },
    startDemo: (speed) => startReplay(speed),
    async stopDemo() {
      stopReplay?.();
      stopReplay = undefined;
      status = { ...status, demo: { running: false } };
      statusE.emit(status);
    },
    pickHearthstonePath: async () => 'D:\\Games\\Hearthstone',
    async checkForUpdates() {
      status = { ...status, update: { state: 'checking', canInstall: true } };
      statusE.emit(status);
      await new Promise((r) => setTimeout(r, 600));
      status = { ...status, update: { state: 'up-to-date', latest: status.version, canInstall: true, checkedAt: new Date().toISOString() } };
      statusE.emit(status);
    },
    async installUpdate() {
      console.info('[mock bridge] install update');
    },
    async fixLogConfig() {
      status = { ...status, logConfig: 'updated' };
      statusE.emit(status);
      return 'updated';
    },
    setInteractive(interactive) {
      document.documentElement.dataset.interactive = String(interactive);
    },
    openSettings() {
      window.open(`settings.html${window.location.search}`, '_blank');
    },
    openExternal(url) {
      window.open(url, '_blank', 'noopener');
    },
    quit() {
      console.info('[mock bridge] quit');
    },
    async exportDiagnostics(o) {
      await new Promise((r) => setTimeout(r, 1200));
      const path = `C:\\Users\\you\\Desktop\\TavernLens-diagnostics-demo${o?.includeGameLogs === false ? '-nologs' : ''}.zip`;
      return { ok: true, path, bytes: 1_234_567, files: [{ name: 'README.txt', size: 2000 }] };
    },
    async openLogsFolder() {
      console.info('[mock bridge] open logs folder');
    },
    logEvent(level, scope, message, data) {
      // console.info, not console.error: the renderer forwards console.error here.
      console.info(`[mock bridge] log ${level} [${scope}] ${message}`, data ?? '');
      if (level === 'error' && status.diagnostics) {
        const d = status.diagnostics;
        const recentErrors = [...d.recentErrors, { at: Date.now(), scope: `renderer/${scope}`, message }].slice(-5);
        status = { ...status, diagnostics: { ...d, errorCount: d.errorCount + 1, recentErrors } };
        statusE.emit(status);
      }
    },
    showItemInFolder(path) {
      console.info('[mock bridge] show in folder', path);
    },
  };

  // Expose hotkey simulation for manual testing: window.__tlToggle('opponentsPanel')
  (window as unknown as { __tlToggle: (w: WidgetId) => void }).__tlToggle = (w) => toggleE.emit(w);
  return bridge;
}

function gameOverRecord(s: BgGameState): MatchRecord {
  const local = s.players.find((p) => p.isLocal)!;
  return {
    id: s.gameId,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? Date.now(),
    mode: s.mode,
    gameType: s.gameType,
    heroCardId: local.heroCardId,
    heroName: local.heroName,
    baseHeroCardId: local.heroCardId,
    heroOptions: samples.HERO_OPTIONS,
    placement: s.finalPlacement ?? 2,
    turns: s.turn,
    finalTier: local.tavernTier,
    finalBoard: s.localBoard,
    availableTribes: s.availableTribes,
    anomalyCardId: s.anomalyCardId,
    tierHistory: local.tierHistory,
    combats: s.battles.map((b) => ({
      turn: b.turn,
      opponentPlayerId: 0,
      opponentHeroCardId: '',
      result: b.actual?.result ?? 'tied',
      damage: b.actual?.damage ?? 0,
      prediction: b.result,
    })),
    healthHistory: local.healthHistory,
    lobby: s.players.map((p) => ({ playerId: p.playerId, heroCardId: p.heroCardId, place: p.leaderboardPlace, name: p.name })),
  };
}
