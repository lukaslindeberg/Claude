import type { HealthChartData, HealthHit, HealthPoint } from '../lib/healthChart';
import { Tooltip } from './Tooltip';

const PAD = { left: 20, right: 6, top: 6, bottom: 14 };

/** A step of 5 / 10 / 20 so the top gridline sits just above the highest value. */
function niceMax(v: number): number {
  const step = v <= 25 ? 5 : v <= 60 ? 10 : 20;
  return Math.ceil(v / step) * step;
}

/**
 * Compact health graph (hand-rolled SVG): your health (+armor) per turn in bold, the other
 * players as faint lines, and red markers on the fights that cost the most health (hover
 * for turn, opponent and damage). Colours come from CSS variables on `.tl-hchart`, so it
 * reads on both the dark panels and the post-match parchment.
 */
export function HealthChart({
  data,
  width = 360,
  height = 100,
  opponentLabel,
  mineLabel = 'You',
}: {
  data: HealthChartData;
  width?: number;
  height?: number;
  opponentLabel: (hit: HealthHit) => string;
  mineLabel?: string;
}) {
  const top = niceMax(data.maxValue);
  const span = Math.max(1, data.maxTurn - data.minTurn);
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - data.minTurn) / span) * iw;
  const y = (v: number) => PAD.top + ih - (Math.max(0, Math.min(top, v)) / top) * ih;
  const path = (pts: HealthPoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.turn).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const mine = path(data.mine);
  const first = data.mine[0];
  const last = data.mine[data.mine.length - 1];
  const every = span > 16 ? 3 : span > 9 ? 2 : 1;
  const turns: number[] = [];
  for (let t = data.minTurn; t <= data.maxTurn; t++) if ((t - data.minTurn) % every === 0 || t === data.maxTurn) turns.push(t);
  if (turns.length > 1 && turns[turns.length - 1] - turns[turns.length - 2] < every) turns.splice(turns.length - 2, 1);
  const grid = [0, top / 2, top];

  return (
    <div className="tl-hchart" style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={`${mineLabel}: health per turn`}>
        <defs>
          <linearGradient id="tl-hchart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="tl-hchart__fillstop" stopOpacity="0.32" />
            <stop offset="1" className="tl-hchart__fillstop" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((v) => (
          <g key={v}>
            <line className="tl-hchart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="tl-hchart__axis" x={PAD.left - 4} y={y(v) + 3} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {turns.map((t) => (
          <text key={t} className="tl-hchart__axis" x={x(t)} y={height - 3} textAnchor="middle">
            {t}
          </text>
        ))}
        {data.others.map((l) => (
          <path key={l.key} className="tl-hchart__other" d={path(l.points)}>
            <title>{l.label}</title>
          </path>
        ))}
        <path className="tl-hchart__area" d={`${mine} L${x(last.turn).toFixed(1)},${y(0)} L${x(first.turn).toFixed(1)},${y(0)} Z`} fill="url(#tl-hchart-fill)" />
        <path className="tl-hchart__mine" d={mine}>
          <title>{mineLabel}</title>
        </path>
        <circle className="tl-hchart__end" cx={x(last.turn)} cy={y(last.value)} r={2.6} />
      </svg>
      {data.hits.map((h) => (
        <Tooltip
          key={h.turn}
          className="tl-hchart__hit"
          placement="top"
          content={
            <div className="tl-hchart__tip">
              <b>Turn {h.turn}</b> · −{h.damage} health
              <div>vs. {opponentLabel(h)}</div>
            </div>
          }
        >
          <span className="tl-hchart__dot" style={{ left: x(h.turn), top: y(h.value) }} aria-label={`Turn ${h.turn}: lost ${h.damage} health`} />
        </Tooltip>
      ))}
    </div>
  );
}
