/**
 * Public API of the Battlegrounds log tracker.
 *
 *   const tracker = new BgTracker();          // optional { cardDb, now }
 *   const events = tracker.feedLines(lines);   // Power.log lines (any chunking)
 *   const state = tracker.getState();          // BgGameState (plain JSON, cached per version)
 *
 * See README.md in this folder for the detection logic and log quirks.
 */
export { BgTracker, type BgTrackerOptions } from './tracker';
export { lobbyTribeEvidence, mainTribes, raceToTribe } from './snapshots';
export { PowerLogParser, parsePowerLog, parseEntityRef, tagId, tagName, tagValue } from '../log/powerLogParser';
export type { EntityRef, LogSource, Packet, ParserOptions } from '../log/powerLogParser';
export { EntityStore, type Entity, type PlayerInfo } from '../game/entityStore';
