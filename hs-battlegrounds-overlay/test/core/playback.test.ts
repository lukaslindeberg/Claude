import { describe, expect, it } from 'vitest';
import { BgTracker, logTimeDiff, logTimeMs, MAX_PLAYBACK_LAG_MS } from '../../src/core/bg/tracker';
import { parsePowerLog } from '../../src/core/log/powerLogParser';
import { fixtureLines } from './helpers';

/**
 * With log.config Verbose=true Hearthstone prints every power packet twice: from
 * GameState as soon as the server sends it, and from PowerTaskList when the client plays
 * it back with animations (combats take 20-40 s on screen but a fraction of a second in
 * GameState). The fixtures only contain GameState lines, so we weave in a PowerTaskList
 * copy that lags behind by LAG lines, like a real log during an animated combat.
 */
const LAG = 400;
const GS_POWER = 'GameState.DebugPrintPower() - ';
const PTL_POWER = 'PowerTaskList.DebugPrintPower() - ';
const TS = /^D \S+ /;

interface WeaveOptions {
  lag?: number;
  /** Index of the input line after which the client stops animating (copies are dropped). */
  stopAfter?: number;
  /** Print the remaining copies at the end of the input (default true). */
  drain?: boolean;
}

function withPlayback(lines: string[], opts: WeaveOptions = {}): string[] {
  const lag = opts.lag ?? LAG;
  const out: string[] = [];
  const queue: string[] = [];
  let stopped = false;
  lines.forEach((line, i) => {
    out.push(line);
    if (opts.stopAfter !== undefined && i > opts.stopAfter) stopped = true;
    if (stopped || !line.includes(GS_POWER)) return;
    queue.push(line.replace(GS_POWER, PTL_POWER));
    if (queue.length > lag) {
      // Printed now: stamp the copy with the current time, like the real client.
      const now = TS.exec(line)?.[0] ?? '';
      out.push(queue.shift()!.replace(TS, now));
    }
  });
  if (opts.drain ?? true) {
    const last = [...lines].reverse().find((l) => TS.test(l));
    const now = (last && TS.exec(last)?.[0]) ?? '';
    out.push(...queue.map((l) => l.replace(TS, now)));
  }
  return out;
}

const SAMPLE = 50;
const GE_TAG = /(GameState|PowerTaskList)\.DebugPrintPower\(\) -\s+TAG_CHANGE Entity=GameEntity tag=(TURN|BOARD_VISUAL_STATE) value=(\d+)/;

interface Sample {
  phase: string;
  turn: number;
  battleTurn: number;
  actual: boolean;
  shop: number;
  currentOpponent?: number;
  /** Phase implied by the latest GameEntity TURN / BOARD_VISUAL_STATE of each stream. */
  gsPhase: string;
  ptlPhase?: string;
  /** GameState lines consumed so far. */
  gs: number;
  /** Log time (ms of day) of the latest line. */
  at: number;
}

function streamPhase(s: { turn: number; visual: number }): string {
  return s.visual === 2 || s.turn % 2 === 0 ? 'combat' : 'recruit';
}

function trace(lines: string[], opts: { flush?: boolean } = {}) {
  const t = new BgTracker();
  const samples: Sample[] = [];
  const gsStream = { turn: 0, visual: 0 };
  let ptlStream: { turn: number; visual: number } | undefined;
  let gs = 0;
  let at = NaN;
  const sample = (gsCount: number) => {
    const s = t.getState();
    samples.push({
      phase: s.phase,
      turn: s.turn,
      battleTurn: s.battle.turn,
      actual: !!s.battle.actual,
      shop: s.shop.length,
      currentOpponent: s.currentOpponentPlayerId,
      gsPhase: streamPhase(gsStream),
      ptlPhase: ptlStream && ptlStream.turn > 0 ? streamPhase(ptlStream) : undefined,
      gs: gsCount,
      at,
    });
  };
  lines.forEach((l, i) => {
    t.feedLine(l);
    if (l.includes('GameState.')) gs++;
    const ts = TS.exec(l);
    if (ts) at = logTimeMs(ts[0].slice(2, -1));
    const m = GE_TAG.exec(l);
    if (m) {
      const stream = m[1] === 'GameState' ? gsStream : (ptlStream ??= { turn: 0, visual: 0 });
      if (m[2] === 'TURN') stream.turn = Number(m[3]);
      else stream.visual = Number(m[3]);
    }
    if (i % SAMPLE === 0) sample(gs);
  });
  if (opts.flush ?? true) t.flush();
  sample(gs);
  return { t, samples, gsTotal: gs };
}

describe('animation-paced playback (PowerTaskList)', () => {
  const base = fixtureLines('bg_139963_perfect_game.power.log.gz');
  const plain = trace(base);
  const woven = trace(withPlayback(base));
  const inGame = (x: Sample) => x.phase === 'combat' || x.phase === 'recruit';

  it('ends in the same final state', () => {
    const sa = plain.t.getState();
    const sb = woven.t.getState();
    expect(sb.phase).toBe('gameOver');
    expect(sb.finalPlacement).toBe(sa.finalPlacement);
    expect(sb.battles.map((b) => [b.turn, b.actual?.result, b.actual?.damage])).toEqual(
      sa.battles.map((b) => [b.turn, b.actual?.result, b.actual?.damage]),
    );
  });

  it('follows the animation-paced stream, not the GameState stream', () => {
    const playing = woven.samples.filter((x) => inGame(x) && x.ptlPhase);
    expect(playing.length).toBeGreaterThan(100);
    // The overlay's phase is the one being animated...
    expect(playing.filter((x) => x.phase !== x.ptlPhase)).toEqual([]);
    // ...including moments where GameState has already moved on to the next shop.
    expect(playing.some((x) => x.phase === 'combat' && x.gsPhase === 'recruit')).toBe(true);
    // Without PowerTaskList lines the GameState stream is used, as before.
    const gsOnly = plain.samples.filter(inGame);
    expect(gsOnly.filter((x) => x.phase !== x.gsPhase).length).toBeLessThan(gsOnly.length * 0.02);
  });

  it('reveals the result of the combat being animated as soon as the log knows it', () => {
    // GameState resolves the combat right away; the result is shown while the playback
    // (and so the overlay's phase) is still in that combat.
    const early = woven.samples.filter((x) => x.phase === 'combat' && x.actual && x.battleTurn >= x.turn);
    expect(early.length).toBeGreaterThan(0);
  });

  it('shows game over only after the final combat has been played back', () => {
    // When every GameState line has been read the game is over in the log, but the
    // playback is still behind: the overlay must not jump to the post-match screen yet.
    const caughtUp = woven.samples.filter((x) => x.gs === woven.gsTotal);
    expect(caughtUp.length).toBeGreaterThan(1);
    expect(caughtUp[0].phase).not.toBe('gameOver');
    expect(caughtUp[caughtUp.length - 1].phase).toBe('gameOver');
  });

  it('names the opponent being fought and shows no shop while GameState is in another phase', () => {
    // GameState already moved on to the next shop while the fight is animated...
    const animating = woven.samples.filter((x) => x.phase === 'combat' && x.gsPhase === 'recruit');
    expect(animating.length).toBeGreaterThan(10);
    expect(animating.filter((x) => !x.currentOpponent).length).toBeLessThan(animating.length * 0.05);
    // ...or into combat while the previous shop is still on screen: the dummy player's
    // minions are then the opponent's board, not a shop.
    expect(woven.samples.filter((x) => x.phase === 'recruit' && x.gsPhase === 'combat' && x.shop > 0)).toEqual([]);
  });
});

describe('animation-paced playback: edge cases', () => {
  const base = fixtureLines('bg_139963_perfect_game.power.log.gz');
  const gsTurnLine = (turn: number) =>
    base.findIndex((l) => l.includes(`GameState.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=TURN value=${turn} `));

  it('measures log time across midnight', () => {
    expect(logTimeDiff('00:00:10.0000000', '23:59:50.0000000')).toBe(20_000);
    expect(logTimeDiff('13:00:00.5000000', '13:00:00.0000000')).toBe(500);
    expect(logTimeDiff('12:59:59.0000000', '13:00:00.0000000')).toBe(0);
    expect(logTimeDiff('', '13:00:00.0000000')).toBeNaN();
  });

  it('stops following a playback that stalls mid-game', () => {
    const stop = gsTurnLine(12);
    const stopAt = logTimeMs(TS.exec(base[stop])![0].slice(2, -1));
    const run = trace(withPlayback(base, { stopAfter: stop, drain: false }), { flush: false });
    const late = run.samples.filter((x) => x.at - stopAt > MAX_PLAYBACK_LAG_MS + 120_000 && x.phase !== 'gameOver');
    expect(late.length).toBeGreaterThan(50);
    // Back on the GameState stream (turn and phase), not stuck on the stalled turn.
    expect(late.filter((x) => x.phase !== x.gsPhase).length).toBeLessThan(late.length * 0.02);
    expect(Math.max(...late.map((x) => x.turn))).toBeGreaterThan(8);
    // ...and it reaches game over without waiting for the log to end.
    expect(run.samples[run.samples.length - 1].phase).toBe('gameOver');
  });

  it('reaches game over when the final combat is never played back and the log goes quiet', () => {
    let now = 1_000_000;
    const t = new BgTracker({ now: () => now });
    const complete = base.findIndex((l) => l.includes('GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STATE value=COMPLETE'));
    expect(complete).toBeGreaterThan(0);
    // The client leaves the game screen mid-way through the final combat.
    for (const l of withPlayback(base.slice(0, complete + 1), { drain: false })) t.feedLine(l);
    expect(t.getState().phase).toBe('combat');
    expect(t.tick()).toBe(false);
    now += 60_000;
    expect(t.tick()).toBe(false);
    expect(t.getState().phase).toBe('combat');
    now += MAX_PLAYBACK_LAG_MS;
    expect(t.tick()).toBe(true);
    expect(t.getState().phase).toBe('gameOver');
    expect(t.tick()).toBe(false);
  });

  it('restarts the playback on a reconnect instead of showing the previous connection\'s turn', () => {
    const t = new BgTracker();
    // Disconnect during the turn-12 fight: the client was still animating turn 11.
    const cut = gsTurnLine(12) + 600;
    const before = withPlayback(base.slice(0, cut), { drain: false, lag: 3000 });
    for (const l of before) t.feedLine(l);
    expect(t.getState().turn).toBeLessThan(6); // the playback is a few turns behind GameState
    // Reconnect: same GAME_SEED, GameState TURN=12 in the GameEntity block.
    const header: string[] = [];
    for (const l of base.slice(0, 200)) {
      if (header.length && !/DebugPrintPower\(\) - {5}/.test(l)) break;
      header.push(l.replace(TS, 'D 13:40:00.0000000 '));
      if (l.includes('tag=GAME_SEED')) header.push('D 13:40:00.0000000 GameState.DebugPrintPower() -         tag=TURN value=12');
    }
    for (const l of header) t.feedLine(l);
    expect(t.getState().turn).toBe(6);
    // The playback's own CREATE_GAME restarts it too (e.g. stale lines in between).
    t.feedLine('D 13:40:01.0000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=TURN value=21 ');
    expect(t.getState().turn).toBe(6); // ahead of GameState: ignored
    t.feedLine('D 13:40:02.0000000 PowerTaskList.DebugPrintPower() - CREATE_GAME');
    t.feedLine('D 13:40:03.0000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=TURN value=12 ');
    expect(t.getState().turn).toBe(6);
    expect(t.getState().phase).toBe('combat');
  });

  it('follows the playback in a Duos game too', () => {
    const duos = fixtureLines('bg_duos_trinkets_206605.power.log.gz');
    const plain = trace(duos);
    const run = trace(withPlayback(duos));
    expect(run.t.getState().finalPlacement).toBe(plain.t.getState().finalPlacement);
    expect(run.t.getState().phase).toBe('gameOver');
    const playing = run.samples.filter((x) => (x.phase === 'combat' || x.phase === 'recruit') && x.ptlPhase);
    expect(playing.length).toBeGreaterThan(50);
    expect(playing.filter((x) => x.phase !== x.ptlPhase)).toEqual([]);
  });
});

describe('PowerLogParser playback packets', () => {
  it('emits GameEntity TURN / BOARD_VISUAL_STATE / STATE and CREATE_GAME of the inactive PowerTaskList stream', () => {
    const pk = parsePowerLog([
      'D 10:00:00.0000000 GameState.DebugPrintPower() - CREATE_GAME',
      'D 10:00:00.1000000 PowerTaskList.DebugPrintPower() -     CREATE_GAME',
      'D 10:00:00.2000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=TURN value=3 ',
      'D 10:00:00.3000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_READY ',
      'D 10:00:00.4000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=Foo tag=TURN value=3 ',
      'D 10:00:00.5000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=STATE value=COMPLETE ',
    ]).filter((p) => p.type === 'Playback');
    expect(pk).toEqual([
      { type: 'Playback', ts: '10:00:00.1000000', tag: 0, value: 0, reset: true },
      { type: 'Playback', ts: '10:00:00.2000000', tag: 20, value: 3 },
      { type: 'Playback', ts: '10:00:00.5000000', tag: 204, value: 3 },
    ]);
  });

  it('treats a PowerTaskList-only log as the game state', () => {
    const pk = parsePowerLog([
      'D 10:00:00.1000000 PowerTaskList.DebugPrintPower() -     CREATE_GAME',
      'D 10:00:00.2000000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=TURN value=3 ',
    ]);
    expect(pk.map((p) => p.type)).toEqual(['CreateGame', 'TagChange']);
  });
});
