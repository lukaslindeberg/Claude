import { describe, expect, it } from 'vitest';
import type { BgGameState, PlayerState } from '@shared/types';
import { BgTracker } from '../../src/core/bg';
import { fixtureLines, ofType } from './helpers';

const DUOS = ['bg_duos_trinkets_206605.power.log.gz', 'bg_duos_aberrations_deity_2026.power.log.gz'];

function teams(state: BgGameState): Map<number, PlayerState[]> {
  const out = new Map<number, PlayerState[]>();
  for (const p of state.players) {
    expect(p.teamId).toBeDefined();
    const l = out.get(p.teamId!) ?? [];
    l.push(p);
    out.set(p.teamId!, l);
  }
  return out;
}

/** Team invariants that must hold in every Duos state. */
function checkTeams(state: BgGameState, where: string): void {
  if (state.players.length < 8) return;
  const byTeam = teams(state);
  expect([...byTeam.values()].map((l) => l.length), where).toEqual([2, 2, 2, 2]);
  for (const [a, b] of byTeam.values()) {
    // one shared health pool, one place, eliminated together
    expect([b.health, b.armor, b.leaderboardPlace, b.dead], `${where} team ${a.teamId}`).toEqual([a.health, a.armor, a.leaderboardPlace, a.dead]);
  }
  const local = state.players.find((p) => p.isLocal)!;
  const mates = state.players.filter((p) => p.isTeammate);
  expect(mates.map((p) => p.teamId), where).toEqual([local.teamId]);
  if (state.nextOpponentPlayerId) {
    const next = state.players.find((p) => p.playerId === state.nextOpponentPlayerId)!;
    const nextMate = state.players.find((p) => p.playerId === state.nextOpponentTeammatePlayerId);
    expect(nextMate, where).toBeDefined();
    expect(nextMate!.playerId).not.toBe(next.playerId);
    expect(nextMate!.teamId, where).toBe(next.teamId);
    expect(next.teamId, where).not.toBe(local.teamId);
  }
}

describe('Duos teams', () => {
  for (const file of DUOS) {
    it(`${file}: teammates share health, place and elimination in every state`, () => {
      const tracker = new BgTracker({ now: () => 1_700_000_000_000 });
      const lines = fixtureLines(file);
      let checks = 0;
      for (const [i, line] of lines.entries()) {
        const evs = tracker.feedLine(line);
        // after every combat (when the leaderboard heroes are updated one by one) and regularly
        if (evs.length || i % 400 === 0) {
          const st = tracker.getState();
          if (st.active && st.mode === 'duos' && st.turn > 0) {
            checkTeams(st, `line ${i + 1}`);
            checks++;
          }
        }
      }
      tracker.flush();
      const end = tracker.getState();
      checkTeams(end, 'end');
      expect(checks).toBeGreaterThan(100);
      // health histories are per team too
      for (const [a, b] of teams(end).values()) expect(b.healthHistory).toEqual(a.healthHistory);
    });
  }

  it('the next opponent comes with their teammate (NEXT_OPPONENT_TEAMMATE_PLAYER_ID) and the sim input pairs them', () => {
    const tracker = new BgTracker({ now: () => 1 });
    const seen: string[] = [];
    for (const line of fixtureLines(DUOS[0])) {
      for (const e of tracker.feedLine(line)) {
        if (e.type !== 'combatStart') continue;
        const st = tracker.getState();
        const opp = [e.input.opponent.playerId, e.input.opponent.teammate!.playerId].sort();
        // the opposing team fights with both boards: exactly the announced pair
        expect([st.nextOpponentPlayerId, st.nextOpponentTeammatePlayerId].sort()).toEqual(opp);
        seen.push(opp.join('+'));
      }
    }
    expect(seen.join(' ')).toBe('5+6 1+4 7+8 5+6 1+4 7+8 5+6 1+4 7+8');
  });

  it('opponent names: the dummy keeps the first enemy fighter`s name while their teammate fights', () => {
    // The converted fixture prints the dummy as Bob's skin all game. Rename it during each
    // combat the way the client does: after the first fighters are installed the dummy is
    // printed under the FIRST enemy fighter's name until the combat ends, also after their
    // teammate took over (BACON_CURRENT_COMBAT_PLAYER_ID changes, the name does not).
    const lines: string[] = [];
    let name: string | undefined;
    const firstFighters = new Set<number>();
    for (const line of fixtureLines(DUOS[0])) {
      const m = /Entity=Cerberus tag=BACON_CURRENT_COMBAT_PLAYER_ID value=(\d+)/.exec(line);
      if (m) {
        const pid = +m[1];
        if (pid === 0) name = undefined;
        else if (!name) {
          name = `Fighter${pid}#100${pid}`;
          firstFighters.add(pid);
          lines.push(line);
          continue;
        }
      }
      lines.push(name ? line.replace('Entity=Cerberus ', `Entity=${name} `) : line);
    }
    const tracker = new BgTracker({ now: () => 1 });
    for (const line of lines) tracker.feedLine(line);
    tracker.flush();
    const st = tracker.getState();
    expect([...firstFighters].sort()).toEqual([1, 4, 6, 7, 8]);
    for (const p of st.players) {
      if (p.isLocal) continue;
      // only ever named after the combats they started; never their teammate's name
      if (firstFighters.has(p.playerId)) expect(p.name).toBe(`Fighter${p.playerId}#100${p.playerId}`);
      else expect(p.name).toBeUndefined();
    }
    const rec = ofType(tracker.flush(), 'gameEnd')[0]?.record ?? tracker.getMatchRecord();
    expect(rec?.lobby.find((l) => l.playerId === 6)?.name).toBe('Fighter6#1006');
  });
});
