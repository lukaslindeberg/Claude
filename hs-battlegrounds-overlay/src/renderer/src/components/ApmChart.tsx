import type { ApmTurn } from '@shared/types';

const PAD = { left: 20, right: 6, top: 8, bottom: 14 };

/** APM of one shop phase (undefined when it was too short to mean anything). */
export function turnApm(t: ApmTurn): number | undefined {
  return t.ms >= 5000 ? (t.actions * 60000) / t.ms : undefined;
}

/** Game average: all actions over all shop time. */
export function averageApm(turns: ApmTurn[]): number | undefined {
  const ms = turns.reduce((a, t) => a + t.ms, 0);
  const actions = turns.reduce((a, t) => a + t.actions, 0);
  return ms >= 5000 ? (actions * 60000) / ms : undefined;
}

function niceMax(v: number): number {
  const step = v <= 30 ? 10 : v <= 100 ? 20 : 50;
  return Math.max(step, Math.ceil(v / step) * step);
}

const fmtTime = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/**
 * APM per turn (hand-rolled SVG): one bar per shop phase, the game average as a dashed line.
 * Each bar's tooltip has the turn's actions and shop time. Styled like the health graph
 * (`.tl-hchart` colours), so it reads on the dark panels and the post-match parchment.
 */
export function ApmChart({ turns, width = 360, height = 90 }: { turns: ApmTurn[]; width?: number; height?: number }) {
  const rows = turns.filter((t) => t.turn > 0).sort((a, b) => a.turn - b.turn);
  if (!rows.length) return null;
  const values = rows.map((t) => turnApm(t) ?? 0);
  const avg = averageApm(rows);
  const top = niceMax(Math.max(...values, avg ?? 0, 1));
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const slot = iw / rows.length;
  const bw = Math.max(3, Math.min(22, slot * 0.64));
  const y = (v: number) => PAD.top + ih - (Math.min(top, v) / top) * ih;
  const every = rows.length > 16 ? 3 : rows.length > 9 ? 2 : 1;
  return (
    <div className="tl-hchart tl-apmchart" style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Actions per minute per turn">
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line className="tl-hchart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="tl-hchart__axis" x={PAD.left - 4} y={y(v) + 3} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {rows.map((t, i) => {
          const cx = PAD.left + slot * (i + 0.5);
          const v = values[i];
          const apm = turnApm(t);
          return (
            <g key={t.turn}>
              <rect className="tl-apmchart__bar" x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx={1.5}>
                <title>{`Turn ${t.turn}: ${t.actions} action${t.actions === 1 ? '' : 's'} in ${fmtTime(t.ms)}${apm === undefined ? '' : ` · ${Math.round(apm)} APM`}`}</title>
              </rect>
              {i % every === 0 || i === rows.length - 1 ? (
                <text className="tl-hchart__axis" x={cx} y={height - 3} textAnchor="middle">
                  {t.turn}
                </text>
              ) : null}
            </g>
          );
        })}
        {avg !== undefined ? (
          <g>
            <line className="tl-apmchart__avg" x1={PAD.left} x2={width - PAD.right} y1={y(avg)} y2={y(avg)} />
            <text className="tl-apmchart__avglabel" x={PAD.left + 3} y={y(avg) - 3} textAnchor="start">
              avg {Math.round(avg)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
