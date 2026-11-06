/**
 * Single place where the main process instantiates the Battlegrounds tracker.
 */
import type { CardDb } from '@core/cards/cardDb';
import { BgTracker } from '@core/bg/tracker';
import type { TrackerLike } from './gameFeed';

export function createTracker(cardDb: CardDb): TrackerLike {
  return new BgTracker({ cardDb });
}
