import { useEffect } from 'react';
import type { BattleSimInput, BattleSimOptions, BattleSimResult, BgGameState } from '@shared/types';
import { useApp, type SimRun } from '../store/appStore';

type WorkerReply = { id: number; result: BattleSimResult } | { id: number; error: string };

let worker: Worker | null = null;
let workerBroken: string | null = null;
let nextId = 1;
const pending = new Map<number, (reply: WorkerReply) => void>();

/** Spawns the simulator worker once (lazily) and reuses it. */
function getWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('../../../core/sim/worker.ts', import.meta.url), { type: 'module', name: 'tavern-lens-sim' });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const cb = pending.get(e.data?.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data);
      }
    };
    worker.onerror = (e) => {
      const msg = e.message || 'Simulator worker failed to load';
      e.preventDefault?.();
      for (const [id, cb] of pending) cb({ id, error: msg });
      pending.clear();
      // A load failure leaves the worker unusable; allow one respawn later.
      worker?.terminate();
      worker = null;
      workerBroken = msg;
      setTimeout(() => (workerBroken = null), 10_000);
    };
  } catch (err) {
    workerBroken = err instanceof Error ? err.message : String(err);
  }
  return worker;
}

export function simulate(input: BattleSimInput, options: BattleSimOptions, timeoutMs = 20_000): Promise<BattleSimResult> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error(workerBroken ?? 'Simulator unavailable'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Simulation timed out'));
    }, timeoutMs);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      if ('error' in reply) reject(new Error(reply.error));
      else resolve(reply.result);
    });
    w.postMessage({ id, input, options });
  });
}

/** Iterations of the quick first pass. */
const QUICK_ITERATIONS = 500;

/** Stable key for one combat's simulation input. */
export function simKey(game: BgGameState | null): string | undefined {
  const input = game?.battle?.input;
  if (!game || !input) return undefined;
  const sig = (side: BattleSimInput['player']) => side.minions.map((m) => `${m.cardId}:${m.attack}/${m.health}`).join(',');
  let h = 0;
  const s = sig(input.player) + '|' + sig(input.opponent);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${game.gameId}:${input.turn ?? game.battle.turn}:${(h >>> 0).toString(36)}`;
}

/**
 * Overlay-level runner: whenever a new `battle.input` appears, simulate it once
 * and report the result to the main process (saved with the match).
 */
export function useBattleSimRunner() {
  const game = useApp((s) => s.game);
  const iterations = useApp((s) => s.settings.simIterations);
  const enabled = useApp((s) => s.settings.widgets.battleSim && s.settings.overlayEnabled);
  const key = simKey(game);

  useEffect(() => {
    if (!enabled || !key) return;
    const { sims, setSim, bridge } = useApp.getState();
    if (sims[key]) return;
    const input = useApp.getState().game?.battle.input;
    if (!input) return;
    const turn = input.turn ?? useApp.getState().game?.battle.turn ?? 0;
    const startedAt = Date.now();
    const base: SimRun = { key, turn, status: 'running', startedAt };
    setSim(base);
    const full = iterations || 4000;
    let finished = false;
    // A quick first pass shows odds within ~0.1 s; the full run then refines them.
    if (full > QUICK_ITERATIONS * 2) {
      simulate(input, { iterations: QUICK_ITERATIONS, maxDurationMs: 150 })
        .then((quick) => {
          if (!finished && useApp.getState().sims[key]?.status === 'running') setSim({ ...base, result: quick });
        })
        .catch(() => undefined);
    }
    simulate(input, { iterations: full, maxDurationMs: 2500 })
      .then((result) => {
        finished = true;
        setSim({ ...base, status: 'done', result });
        void bridge?.reportSimResult(turn, result).catch(() => undefined);
      })
      .catch((err: Error) => {
        finished = true;
        setSim({ ...base, status: 'error', error: err.message });
      });
  }, [key, enabled, iterations]);
}

/** The simulation run for the current battle, if any. */
export function useCurrentSim(): SimRun | undefined {
  const game = useApp((s) => s.game);
  const sims = useApp((s) => s.sims);
  const key = simKey(game);
  if (key && sims[key]) return sims[key];
  if (!game) return undefined;
  // Fall back to the most recent run for this turn (e.g. input updated mid-combat).
  const prefix = `${game.gameId}:${game.battle.turn}:`;
  return Object.values(sims)
    .filter((r) => r.key.startsWith(prefix))
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}
