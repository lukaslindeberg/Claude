import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import {
  Store,
  addMatchToHistory,
  applySettingsPatch,
  deepMergeDefaults,
  mergeSimPredictions,
  normalizeSettings,
} from '../../src/main/store';
import { match, sim } from './fixtures';

describe('settings merge', () => {
  it('deep-merges saved values over defaults, keeping new defaults', () => {
    const saved = {
      scale: 1.2,
      widgets: { battleSim: false },
      hotkeys: { toggleOverlay: 'Alt+O' },
      hearthstonePath: 'D:\\HS',
      positions: { battleSim: { x: 0.1, y: 0.2 } },
    };
    const s = normalizeSettings(saved);
    expect(s.scale).toBe(1.2);
    expect(s.widgets.battleSim).toBe(false);
    expect(s.widgets.opponentsPanel).toBe(true); // default retained
    expect(s.hotkeys).toEqual({ ...DEFAULT_SETTINGS.hotkeys, toggleOverlay: 'Alt+O' });
    expect(s.hearthstonePath).toBe('D:\\HS');
    expect(s.positions).toEqual({ battleSim: { x: 0.1, y: 0.2 } });
  });

  it('drops widgets, hotkeys and options of removed features from old settings files', () => {
    const s = normalizeSettings({
      widgets: { tierList: true, leaderboardHover: false, battleSim: false },
      hotkeys: { toggleTierList: 'CommandOrControl+Shift+T', toggleOpponents: 'Alt+P' },
      positions: { tierList: { x: 0.1, y: 0.2 }, lobbyInfo: { x: 0.3, y: 0.4 } },
      leaderboardCalibration: { left: -0.7, top: 0.1, width: 0.13, slotHeight: 0.09, gap: 0 },
      leaderboardCalibrationMode: true,
    });
    expect(Object.keys(s.widgets).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.widgets).sort());
    expect(s.widgets.battleSim).toBe(false);
    expect(s.hotkeys).toEqual({ ...DEFAULT_SETTINGS.hotkeys, toggleOpponents: 'Alt+P' });
    expect(s.positions).toEqual({ lobbyInfo: { x: 0.3, y: 0.4 } });
    expect('leaderboardCalibration' in s).toBe(false);
    expect('leaderboardCalibrationMode' in s).toBe(false);
    // A patch from an old renderer cannot bring them back either.
    const patched = applySettingsPatch(s, { hotkeys: { toggleTierList: 'F5' } as never, widgets: { tierList: true } as never });
    expect('toggleTierList' in patched.hotkeys).toBe(false);
    expect('tierList' in patched.widgets).toBe(false);
  });

  it('ignores values of the wrong type and clamps ranges', () => {
    const s = normalizeSettings({ scale: 'big', opacity: 5, overlayEnabled: 'yes', simIterations: 3 });
    expect(s.scale).toBe(DEFAULT_SETTINGS.scale);
    expect(s.opacity).toBe(1);
    expect(s.overlayEnabled).toBe(true);
    expect(s.simIterations).toBe(100);
  });

  it('handles garbage', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(deepMergeDefaults({ a: [1] }, { a: 'x' })).toEqual({ a: [1] });
  });

  it('does not share nested objects with DEFAULT_SETTINGS', () => {
    const s = normalizeSettings({});
    s.widgets.battleSim = false;
    expect(DEFAULT_SETTINGS.widgets.battleSim).toBe(true);
  });

  it('applies patches: shallow-merge objects, replace positions, delete on undefined', () => {
    let s = normalizeSettings({ hearthstonePath: 'C:\\HS', positions: { battleSim: { x: 0.5, y: 0.5 } } });
    s = applySettingsPatch(s, { widgets: { battleSim: false } as never, overlayEnabled: false });
    expect(s.widgets.battleSim).toBe(false);
    expect(s.widgets.opponentsPanel).toBe(true);
    expect(s.overlayEnabled).toBe(false);
    s = applySettingsPatch(s, { positions: { battleSim: { x: 0.2, y: 0.3 } } });
    expect(s.positions).toEqual({ battleSim: { x: 0.2, y: 0.3 } });
    s = applySettingsPatch(s, { positions: {} });
    expect(s.positions).toEqual({});
    s = applySettingsPatch(s, { hearthstonePath: undefined });
    expect('hearthstonePath' in s).toBe(false);
  });
});

describe('history', () => {
  it('merges sim predictions into the matching combats', () => {
    const rec = match({
      combats: [
        { turn: 1, opponentPlayerId: 2, opponentHeroCardId: 'X', result: 'won', damage: 3 },
        { turn: 2, opponentPlayerId: 3, opponentHeroCardId: 'Y', result: 'lost', damage: 5, prediction: sim(10) },
        { turn: 3, opponentPlayerId: 4, opponentHeroCardId: 'Z', result: 'tied', damage: 0 },
      ],
    });
    const preds = new Map([
      [1, sim(80)],
      [2, sim(50)],
      [7, sim(1)],
    ]);
    const out = mergeSimPredictions(rec, preds);
    expect(out.combats[0].prediction?.win).toBe(80);
    expect(out.combats[1].prediction?.win).toBe(10); // tracker-provided prediction wins
    expect(out.combats[2].prediction).toBeUndefined();
    expect(rec.combats[0].prediction).toBeUndefined(); // input not mutated
    expect(mergeSimPredictions(rec, { 3: sim(42) }).combats[2].prediction?.win).toBe(42);
  });

  it('keeps newest first, replaces duplicates and caps', () => {
    const a = match({ endedAt: 100 });
    const b = match({ endedAt: 200 });
    let h = addMatchToHistory([], a);
    h = addMatchToHistory(h, b);
    expect(h.map((m) => m.id)).toEqual([b.id, a.id]);
    h = addMatchToHistory(h, { ...a, placement: 1 });
    expect(h).toHaveLength(2);
    expect(h.find((m) => m.id === a.id)?.placement).toBe(1);
    const many = Array.from({ length: 10 }, (_, i) => match({ endedAt: 1000 + i }));
    const capped = many.reduce((acc, m) => addMatchToHistory(acc, m, 5), [] as ReturnType<typeof match>[]);
    expect(capped).toHaveLength(5);
    expect(capped[0].endedAt).toBe(1009);
  });
});

describe('Store', () => {
  it('persists settings and history atomically and reloads them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-store-'));
    const s1 = new Store(dir);
    expect(s1.firstRun).toBe(true);
    s1.updateSettings({ scale: 1.3 });
    s1.addMatch(match({ id: 'persisted' }));
    await s1.flush();
    const s2 = new Store(dir);
    expect(s2.firstRun).toBe(false);
    expect(s2.getSettings().scale).toBe(1.3);
    expect(s2.getHistory().map((m) => m.id)).toEqual(['persisted']);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).scale).toBe(1.3);
  });

  it('survives corrupt files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-store-'));
    writeFileSync(join(dir, 'settings.json'), '{not json');
    writeFileSync(join(dir, 'history.json'), '[{"id":1},{"bogus":true}]');
    const s = new Store(dir);
    expect(s.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(s.getHistory()).toEqual([]);
  });
});
