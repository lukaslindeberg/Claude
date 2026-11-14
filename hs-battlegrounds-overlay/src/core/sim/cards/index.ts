/**
 * Registers every card handler. Idempotent; called by `simulateBattle`.
 * Add new tribe/effect files here.
 */
import { registerAberrations } from './aberration';
import { registerAnomalies } from './anomalies';
import { registerDarkGifts } from './darkGifts';
import { registerBeasts } from './beast';
import { registerDemons } from './demon';
import { registerDragons } from './dragon';
import { registerElementals } from './elemental';
import { registerHeroPowers } from './heroPowers';
import { registerMechs } from './mech';
import { registerMurlocs } from './murloc';
import { registerNaga } from './naga';
import { registerNeutrals } from './neutral';
import { registerPirates } from './pirate';
import { registerQuestRewards } from './questRewards';
import { registerQuilboar } from './quilboar';
import { registerTimewarped } from './timewarped';
import { registerTrinkets } from './trinkets';
import { registerUndead } from './undead';

let registered = false;

export function ensureCardsRegistered(): void {
  if (registered) return;
  registered = true;
  registerNeutrals();
  registerBeasts();
  registerDemons();
  registerDragons();
  registerElementals();
  registerMechs();
  registerMurlocs();
  registerNaga();
  registerPirates();
  registerQuilboar();
  registerUndead();
  registerAberrations();
  registerTimewarped();
  registerHeroPowers();
  registerTrinkets();
  registerQuestRewards();
  registerAnomalies();
  registerDarkGifts();
}

export * from './registry';
