/**
 * Web Worker entry for the battle simulator.
 *
 *   const worker = new Worker(new URL('../../core/sim/worker.ts', import.meta.url), { type: 'module' });
 *   worker.postMessage({ id, input, options } satisfies SimWorkerRequest);
 *   worker.onmessage = (ev: MessageEvent<SimWorkerResponse>) => ...
 */
import type { BattleSimInput, BattleSimOptions, BattleSimResult } from '@shared/types';
import { CardDb } from '../cards/cardDb';
import { simulateBattle } from './simulate';

export interface SimWorkerRequest {
  id: number;
  input: BattleSimInput;
  options?: BattleSimOptions;
}

export type SimWorkerResponse = { id: number; result: BattleSimResult } | { id: number; error: string };

interface WorkerScope {
  onmessage: ((ev: MessageEvent<SimWorkerRequest>) => void) | null;
  postMessage(message: SimWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (ev: MessageEvent<SimWorkerRequest>) => {
  const { id, input, options } = ev.data ?? ({} as SimWorkerRequest);
  try {
    const result = simulateBattle(input, options, CardDb.bundled());
    scope.postMessage({ id, result });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
