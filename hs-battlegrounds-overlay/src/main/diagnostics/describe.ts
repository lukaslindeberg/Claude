/**
 * Compact, human-readable descriptions for the diagnostics log. Pure functions,
 * no Electron imports.
 */
import type { BattleSimResult, BgEvent, GameWindowInfo, SimSide } from '@shared/types';

type NameOf = (cardId: string) => string | undefined;

const pct = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;

function card(id: string | undefined, nameOf?: NameOf): string {
  if (!id) return '?';
  const n = nameOf?.(id);
  return n && n !== id ? `${n} (${id})` : id;
}

function boardStats(side: Pick<SimSide, 'minions'>): string {
  let atk = 0;
  let hp = 0;
  for (const m of side.minions) {
    atk += m.attack;
    hp += m.health;
  }
  return `${side.minions.length} minions ${atk}/${hp}`;
}

function sideText(side: SimSide, nameOf?: NameOf): string {
  const tm = side.teammate ? ` + teammate ${card(side.teammate.heroCardId, nameOf)} ${boardStats(side.teammate)}` : '';
  return `${card(side.heroCardId, nameOf)} [p${side.playerId}] tier ${side.tavernTier} hp ${side.health}+${side.armor}, ${boardStats(side)}, hand ${side.hand.length}${tm}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** One line per tracker event. */
export function describeEvent(e: BgEvent, nameOf?: NameOf): string {
  switch (e.type) {
    case 'gameStart':
      return `game start ${e.gameId} · ${e.mode} · ${e.gameType}${e.spectating ? ' · spectating' : ''}`;
    case 'heroOptions':
      return `hero options: ${e.options.map((o) => card(o.cardId, () => o.name)).join(', ') || '(none)'}`;
    case 'heroChosen':
      return `hero chosen: ${card(e.cardId, nameOf)}`;
    case 'turnStart':
      return `turn ${e.turn}`;
    case 'combatStart': {
      const i = e.input;
      const extra = [i.anomalyCardId ? `anomaly ${i.anomalyCardId}` : '', i.damageCap ? `damage cap ${i.damageCap}` : '']
        .filter(Boolean)
        .join(', ');
      return `combat start t${e.turn} (${i.mode}): us ${sideText(i.player, nameOf)} vs ${sideText(i.opponent, nameOf)}${extra ? ` · ${extra}` : ''}`;
    }
    case 'combatEnd':
      return `combat end t${e.turn}: ${e.record.result}${e.record.result === 'tied' ? '' : ` ${e.record.damage}`} vs ${card(e.record.opponentHeroCardId, nameOf)} [p${e.record.opponentPlayerId}]`;
    case 'playerDied':
      return `player p${e.playerId} died on turn ${e.turn}`;
    case 'gameEnd': {
      const r = e.record;
      return `game end ${r.id}: #${r.placement} with ${card(r.heroCardId, () => r.heroName)} after ${r.turns} turns, tier ${r.finalTier}, ${r.combats.length} combats, ${formatDuration((r.endedAt || 0) - (r.startedAt || 0))}`;
    }
    default:
      return `event ${(e as { type: string }).type}`;
  }
}

/** `win 62.1% tie 5.0% loss 32.9% · dmg +4.2/-3.1 · lethal 0.0%/2.0% · 4000 it in 812 ms · unsupported: X, Y` */
export function describeSim(r: BattleSimResult): string {
  const unsupported = r.unsupported?.length ? ` · unsupported: ${r.unsupported.join(', ')}` : '';
  return (
    `win ${pct(r.win)} tie ${pct(r.tie)} loss ${pct(r.loss)} · dmg +${r.avgDamageDealt.toFixed(1)}/-${r.avgDamageTaken.toFixed(1)}` +
    ` · lethal ${pct(r.lethalWin)}/${pct(r.lethalLoss)} · ${r.iterations} it in ${Math.round(r.durationMs)} ms${unsupported}`
  );
}

export type Outcome = 'won' | 'lost' | 'tied';

export interface SimVerdict {
  /** The simulator's most likely outcome. */
  predicted: Outcome;
  matched: boolean;
  /** Probability (0..100) the simulator gave the actual outcome. */
  actualChance: number;
  /** The actual outcome had a very low simulated chance: likely a simulator or tracking bug. */
  surprise: boolean;
}

export const SURPRISE_BELOW_PCT = 5;

export function simVerdict(r: Pick<BattleSimResult, 'win' | 'tie' | 'loss'>, actual: Outcome): SimVerdict {
  const predicted: Outcome = r.win >= r.loss && r.win >= r.tie ? 'won' : r.loss >= r.tie ? 'lost' : 'tied';
  const actualChance = Math.round((actual === 'won' ? r.win : actual === 'lost' ? r.loss : r.tie) * 100) / 100;
  return { predicted, matched: predicted === actual, actualChance, surprise: actualChance < SURPRISE_BELOW_PCT };
}

export function describeVerdict(v: SimVerdict): string {
  return `${v.matched ? 'matched' : 'MISMATCH'} (sim predicted ${v.predicted}, gave the actual result ${pct(v.actualChance)})${v.surprise ? ' SURPRISE' : ''}`;
}

export function describeWindow(info: GameWindowInfo): string {
  if (!info.found) return 'not found';
  const flags = [info.focused ? 'focused' : 'unfocused', info.minimized ? 'minimized' : ''].filter(Boolean).join(', ');
  const b = info.bounds;
  return `found, ${flags}${b ? `, client ${b.width}x${b.height} at ${b.x},${b.y}` : ', no bounds'}`;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? '(unset)' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));

/** Settings changes as `key: old -> new` (nested one level; widget positions summarised). */
export function diffSettings(prev: object, next: object): string[] {
  const a = prev as Json;
  const b = next as Json;
  const out: string[] = [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (k === 'positions') {
      const px = isObj(x) ? x : {};
      const py = isObj(y) ? y : {};
      const changed = [...new Set([...Object.keys(px), ...Object.keys(py)])].filter(
        (id) => JSON.stringify(px[id]) !== JSON.stringify(py[id]),
      );
      out.push(`positions: ${Object.keys(py).length ? `moved ${changed.join(', ')}` : 'reset'}`);
    } else if (isObj(x) && isObj(y)) {
      for (const sk of [...new Set([...Object.keys(x), ...Object.keys(y)])]) {
        if (JSON.stringify(x[sk]) !== JSON.stringify(y[sk])) out.push(`${k}.${sk}: ${show(x[sk])} -> ${show(y[sk])}`);
      }
    } else out.push(`${k}: ${show(x)} -> ${show(y)}`);
  }
  return out;
}

/** Wall-clock ms of the day (local time), for comparison with Power.log timestamps. */
export function msOfDay(d: Date): number {
  return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
}

/** Power.log `HH:MM:SS.fffffff` -> ms of the day, NaN if malformed. */
export function logTsMs(ts: string): number {
  const m = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(ts);
  if (!m) return NaN;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

/** How long ago (ms) a Power.log line was written, judged by the local clock; NaN if unknown. */
export function logLineAgeMs(ts: string, now: Date): number {
  const t = logTsMs(ts);
  if (Number.isNaN(t)) return NaN;
  let d = msOfDay(now) - t;
  if (d < -43_200_000) d += 86_400_000;
  else if (d > 43_200_000) d -= 86_400_000;
  return d;
}
