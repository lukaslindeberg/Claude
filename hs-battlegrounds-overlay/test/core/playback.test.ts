import { describe, expect, it } from 'vitest';
import { BgTracker } from '../../src/core/bg/tracker';
import { fixtureLines } from './helpers';

/**
 * With log.config Verbose=true Hearthstone prints every power packet twice: from
 * GameState as soon as the server sends it, and from PowerTaskList when the client plays
 * it back with animations (combats take 20-40 s on screen but a fraction of a second in
 * GameState). The fixtures only contain GameState lines, so we weave in a PowerTaskList
 * copy that lags behind by LAG lines, like a real log during an animated combat.
 */
const LAG = 400;

function withPlayback(lines: string[]): string[] {
  const out: string[] = [];
  const queue: string[] = [];
  for (const line of lines) {
    out.push(line);
    if (line.includes('GameState.DebugPrintPower() - ')) {
      queue.push(line.replace('GameState.DebugPrintPower() - ', 'PowerTaskList.DebugPrintPower() - '));
      if (queue.length > LAG) out.push(queue.shift()!);
    }
  }
  out.push(...queue);
  return out;
}

const SAMPLE = 50;
const GE_TAG = /(GameState|PowerTaskList)\.DebugPrintPower\(\) -\s+TAG_CHANGE Entity=GameEntity tag=(TURN|BOARD_VISUAL_STATE) value=(\d+)/;

interface Sample {
  phase: string;
  turn: number;
  battleTurn: number;
  actual: boolean;
  /** Phase implied by the latest GameEntity TURN / BOARD_VISUAL_STATE of each stream. */
  gsPhase: string;
  ptlPhase?: string;
  /** GameState lines consumed so far. */
  gs: number;
}

function streamPhase(s: { turn: number; visual: number }): string {
  return s.visual === 2 || s.turn % 2 === 0 ? 'combat' : 'recruit';
}

function trace(lines: string[]) {
  const t = new BgTracker();
  const samples: Sample[] = [];
  const gsStream = { turn: 0, visual: 0 };
  let ptlStream: { turn: number; visual: number } | undefined;
  let gs = 0;
  const sample = (gsCount: number) => {
    const s = t.getState();
    samples.push({
      phase: s.phase,
      turn: s.turn,
      battleTurn: s.battle.turn,
      actual: !!s.battle.actual,
      gsPhase: streamPhase(gsStream),
      ptlPhase: ptlStream && ptlStream.turn > 0 ? streamPhase(ptlStream) : undefined,
      gs: gsCount,
    });
  };
  lines.forEach((l, i) => {
    t.feedLine(l);
    if (l.includes('GameState.')) gs++;
    const m = GE_TAG.exec(l);
    if (m) {
      const stream = m[1] === 'GameState' ? gsStream : (ptlStream ??= { turn: 0, visual: 0 });
      if (m[2] === 'TURN') stream.turn = Number(m[3]);
      else stream.visual = Number(m[3]);
    }
    if (i % SAMPLE === 0) sample(gs);
  });
  t.flush();
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

  it("doesn't reveal the result of the combat being animated", () => {
    // Until a combat's boards are captured, the previous combat's result may still show.
    const spoilers = woven.samples.filter((x) => x.phase === 'combat' && x.actual && x.battleTurn >= x.turn);
    expect(spoilers).toEqual([]);
    expect(woven.samples.some((x) => x.phase === 'recruit' && x.actual)).toBe(true);
  });

  it('shows game over only after the final combat has been played back', () => {
    // When every GameState line has been read the game is over in the log, but the
    // playback is still behind: the overlay must not jump to the post-match screen yet.
    const caughtUp = woven.samples.filter((x) => x.gs === woven.gsTotal);
    expect(caughtUp.length).toBeGreaterThan(1);
    expect(caughtUp[0].phase).not.toBe('gameOver');
    expect(caughtUp[caughtUp.length - 1].phase).toBe('gameOver');
  });
});
