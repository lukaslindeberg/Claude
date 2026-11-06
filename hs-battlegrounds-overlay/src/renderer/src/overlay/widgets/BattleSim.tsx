import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BattleSimResult } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useCurrentSim } from '../../hooks/useBattleSim';
import { HeroPortrait } from '../../components/HeroPortrait';
import { OddsBar } from '../../components/Bits';
import { CheckIcon, CrossIcon, SwordIcon, WarningIcon } from '../../components/Icons';
import { num, pct } from '../../lib/format';
import { predictedOutcome } from '../../lib/stats';
import { DragHandle, FloatingWidget } from '../Widget';

const LINGER_MS = 12_000;

/** Visible during combat and for a short while after it resolves. */
function useBattleVisible(): boolean {
  const phase = useApp((s) => s.game?.phase);
  const [linger, setLinger] = useState(false);
  const prev = useRef(phase);
  useEffect(() => {
    const was = prev.current;
    prev.current = phase;
    if (was === 'combat' && phase !== 'combat') {
      setLinger(true);
      const t = setTimeout(() => setLinger(false), LINGER_MS);
      return () => clearTimeout(t);
    }
    // Any other phase change ends the linger (its timer was just cleared): otherwise a
    // concede right after a combat left `linger` stuck and the panel reappeared in the
    // next game's first recruit turn.
    setLinger(false);
  }, [phase]);
  return phase === 'combat' || (linger && phase !== 'gameOver' && phase !== 'heroSelection');
}

export function BattleSimWidget() {
  const visible = useBattleVisible();
  if (!visible) return null;
  return (
    <FloatingWidget
      id="battleSim"
      // Top centre, just left of the opponent's hero portrait so it never covers it.
      defaultPosition={(vp, size) => ({ left: vp.width / 2 - size.width - vp.height * 0.085, top: Math.round(vp.height * 0.012) })}
    >
      {(handle) => <BattleSimPanel handle={handle} />}
    </FloatingWidget>
  );
}

function BattleSimPanel({ handle }: { handle: Parameters<typeof DragHandle>[0]['handle'] }) {
  const game = useApp((s) => s.game)!;
  const db = useApp((s) => s.cardDb);
  const run = useCurrentSim();
  const battle = game.battle;
  const result: BattleSimResult | undefined = run?.result ?? battle.result;
  const status = run?.status ?? (battle.result ? 'done' : battle.status === 'error' ? 'error' : battle.input ? 'running' : 'waiting');
  const error = run?.error ?? battle.error;
  const opp = game.players.find((p) => p.playerId === (game.currentOpponentPlayerId ?? battle.input?.opponent.playerId));
  const oppHero = opp?.heroCardId ?? battle.input?.opponent.heroCardId;
  // Names come from card data; cards missing from it (older patches) fall back to the name in the log.
  const logNames = new Map<string, string>();
  for (const side of [battle.input?.player, battle.input?.opponent]) {
    for (const m of [...(side?.minions ?? []), ...(side?.hand ?? [])]) if (m.name) logNames.set(m.cardId, m.name);
  }
  const unsupported = result?.unsupported?.length
    ? [...new Set(result.unsupported.map((id) => db.name(db.normalOf(id), logNames.get(id))))]
    : [];
  const actual = battle.actual;
  const predicted = result ? predictedOutcome(result) : undefined;
  const matched = actual && predicted ? actual.result === predicted : undefined;

  return (
    <div className={clsx('tl-panel tl-sim', status === 'running' && 'is-running')}>
      <div className="tl-sim__head">
        <DragHandle handle={handle} />
        <SwordIcon size={13} className="tl-gold" />
        <span className="tl-heading">Battle · T{battle.turn || game.turn}</span>
        {oppHero ? (
          <span className="tl-sim__vs">
            <span className="tl-muted">vs</span>
            <HeroPortrait cardId={oppHero} size={20} />
            <span className="tl-sim__opp">{opp?.heroName ?? db.name(oppHero)}</span>
          </span>
        ) : null}
        <span className="tl-sim__status">
          {status === 'running' ? 'Simulating…' : status === 'done' && result ? `${result.iterations.toLocaleString()} sims · ${(result.durationMs / 1000).toFixed(1)}s` : status === 'error' ? 'Simulator error' : 'Waiting for boards'}
        </span>
      </div>

      {result ? (
        <>
          <OddsBar result={result} height={22} />
          <div className="tl-sim__cols">
            <div className="tl-sim__col is-win">
              <span className="tl-sim__big">{pct(result.win)}</span>
              <span className="tl-sim__label">Win</span>
              <span className="tl-sim__sub">
                dmg <b>{num(result.avgDamageDealt)}</b>
                {result.lethalWin > 0 ? (
                  <>
                    {' '}
                    · lethal <b>{pct(result.lethalWin)}</b>
                  </>
                ) : null}
              </span>
            </div>
            <div className="tl-sim__col is-tie">
              <span className="tl-sim__big">{pct(result.tie)}</span>
              <span className="tl-sim__label">Tie</span>
            </div>
            <div className="tl-sim__col is-loss">
              <span className="tl-sim__big">{pct(result.loss)}</span>
              <span className="tl-sim__label">Loss</span>
              <span className="tl-sim__sub">
                dmg <b>{num(result.avgDamageTaken)}</b>
                {result.lethalLoss > 0 ? (
                  <>
                    {' '}
                    · <span className="tl-sim__lethal">lethal {pct(result.lethalLoss)}</span>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </>
      ) : status === 'error' ? (
        <div className="tl-sim__error">
          <WarningIcon size={13} /> {error ?? 'The simulator could not run this combat.'}
        </div>
      ) : (
        <div className="tl-sim__pending">
          <span className="tl-sim__shimmer" />
          <span className="tl-muted">{status === 'running' ? 'Running thousands of combats…' : 'Waiting for both boards…'}</span>
        </div>
      )}

      {unsupported.length ? (
        <div className="tl-sim__warn" title={unsupported.join(', ')}>
          <WarningIcon size={12} />
          <span>
            Approximate — not fully simulated: <b>{unsupported.slice(0, 4).join(', ')}</b>
            {unsupported.length > 4 ? ` +${unsupported.length - 4} more` : ''}
          </span>
        </div>
      ) : null}

      {actual ? (
        <div className={clsx('tl-sim__actual', `is-${actual.result}`)}>
          <span className="tl-sim__actual-label">Result</span>
          <span className="tl-sim__actual-value">
            {actual.result === 'won' ? 'Won' : actual.result === 'lost' ? 'Lost' : 'Tied'}
            {actual.damage ? ` · ${actual.result === 'lost' ? 'took' : 'dealt'} ${actual.damage}` : ''}
          </span>
          {matched !== undefined ? (
            <span className={clsx('tl-sim__match', matched ? 'is-yes' : 'is-no')}>
              {matched ? <CheckIcon size={12} /> : <CrossIcon size={11} />}
              {matched ? 'As predicted' : 'Upset'}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
