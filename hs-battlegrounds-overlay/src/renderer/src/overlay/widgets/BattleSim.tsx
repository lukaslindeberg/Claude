import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { BattleSimResult, BattleState, BgGameState } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useCurrentSim } from '../../hooks/useBattleSim';
import { HeroPortrait } from '../../components/HeroPortrait';
import { Gem, OddsBar } from '../../components/Bits';
import { CheckIcon, ChevronIcon, CrossIcon, SwordsIcon, WarningIcon } from '../../components/Icons';
import { num, pct } from '../../lib/format';
import { predictedOutcome } from '../../lib/stats';
import { DragHandle, FloatingWidget, type HandleProps } from '../Widget';
import { effectiveScale } from '../layout';

const FOLD_KEY = 'tl-battlesim-folded';

function readFolded(): boolean {
  try {
    return sessionStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Full plaque during combat. Through the following recruit phase it stays as a
 * compact "Last battle" view (odds, prediction and the actual result) until the
 * next combat replaces it; hero selection and game over hide it.
 */
function useBattleView(): 'combat' | 'last' | null {
  const phase = useApp((s) => s.game?.phase);
  const battle = useApp((s) => s.game?.battle);
  if (phase === 'combat') return 'combat';
  if (phase === 'recruit' && battle && battle.turn > 0 && (battle.input || battle.result || battle.actual)) return 'last';
  return null;
}

export function BattleSimWidget() {
  const view = useBattleView();
  const settingsScale = useApp((s) => s.settings.scale);
  if (!view) return null;
  return (
    <FloatingWidget
      id="battleSim"
      defaultPosition={(vp, size) =>
        view === 'combat'
          ? // Top centre, just left of the opponent's hero portrait so it never covers it.
            { left: vp.width / 2 - size.width - vp.height * 0.085, top: Math.round(vp.height * 0.012) }
          : // Shop: Bob's tier-up / refresh / freeze buttons own the top centre, so sit in the
            // free top-right corner, left of the leaderboard panel (302px wide at scale 1).
            { left: vp.width - size.width - (302 * effectiveScale(settingsScale, vp) + 22), top: Math.round(vp.height * 0.012) }
      }
    >
      {(handle) => (view === 'combat' ? <BattleSimPanel handle={handle} /> : <LastBattle handle={handle} />)}
    </FloatingWidget>
  );
}

interface BattleInfo {
  battle: BattleState;
  result?: BattleSimResult;
  status: 'running' | 'done' | 'error' | 'waiting';
  error?: string;
  oppHero?: string;
  oppName?: string;
  matched?: boolean;
}

function useBattleInfo(game: BgGameState): BattleInfo {
  const db = useApp((s) => s.cardDb);
  const run = useCurrentSim();
  const battle = game.battle;
  const result: BattleSimResult | undefined = run?.result ?? battle.result;
  const status = run?.status ?? (battle.result ? 'done' : battle.status === 'error' ? 'error' : battle.input ? 'running' : 'waiting');
  const oppId = game.phase === 'combat' ? (game.currentOpponentPlayerId ?? battle.input?.opponent.playerId) : battle.input?.opponent.playerId;
  const opp =
    game.players.find((p) => p.playerId === oppId) ??
    (game.phase !== 'combat' ? game.players.find((p) => p.combatsAgainst.some((c) => c.turn === battle.turn)) : undefined);
  const oppHero = opp?.heroCardId ?? battle.input?.opponent.heroCardId;
  const predicted = result ? predictedOutcome(result) : undefined;
  return {
    battle,
    result,
    status,
    error: run?.error ?? battle.error,
    oppHero,
    oppName: opp?.heroName ?? (oppHero ? db.name(oppHero) : undefined),
    matched: battle.actual && predicted ? battle.actual.result === predicted : undefined,
  };
}

function BattleSimPanel({ handle }: { handle: HandleProps }) {
  const game = useApp((s) => s.game)!;
  const db = useApp((s) => s.cardDb);
  const { battle, result, status, error, oppHero, oppName, matched } = useBattleInfo(game);
  // Names come from card data; cards missing from it (older patches) fall back to the name in the log.
  const logNames = new Map<string, string>();
  for (const side of [battle.input?.player, battle.input?.opponent]) {
    for (const m of [...(side?.minions ?? []), ...(side?.hand ?? [])]) if (m.name) logNames.set(m.cardId, m.name);
  }
  const unsupported = result?.unsupported?.length
    ? [...new Set(result.unsupported.map((id) => db.name(db.normalOf(id), logNames.get(id))))]
    : [];
  const actual = battle.actual;

  return (
    <div className={clsx('tl-panel tl-sim', status === 'running' && 'is-running')}>
      <div className="tl-sim__head">
        <DragHandle handle={handle} />
        <span className="tl-sim__crest">
          <SwordsIcon size={14} />
        </span>
        <span className="tl-sim__title">
          Battle <span className="tl-sim__turn">Turn {battle.turn || game.turn}</span>
        </span>
        {oppHero ? (
          <span className="tl-sim__vs">
            <span className="tl-sim__vsword">vs</span>
            <HeroPortrait cardId={oppHero} size={24} />
            <span className="tl-sim__opp">{oppName}</span>
          </span>
        ) : null}
        <span className="tl-sim__status">
          {status === 'running' ? 'Simulating…' : status === 'done' && result ? `${result.iterations.toLocaleString()} sims · ${(result.durationMs / 1000).toFixed(1)}s` : status === 'error' ? 'Simulator error' : 'Waiting for boards'}
        </span>
      </div>

      {result ? (
        <>
          <div className="tl-sim__cols">
            <div className="tl-sim__col is-win">
              <span className="tl-sim__gemrow">
                <Gem tone="win" size={13} />
                <span className="tl-sim__big">{pct(result.win)}</span>
              </span>
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
              <span className="tl-sim__gemrow">
                <Gem tone="tie" size={11} />
                <span className="tl-sim__big">{pct(result.tie)}</span>
              </span>
              <span className="tl-sim__label">Tie</span>
            </div>
            <div className="tl-sim__col is-loss">
              <span className="tl-sim__gemrow">
                <Gem tone="loss" size={13} />
                <span className="tl-sim__big">{pct(result.loss)}</span>
              </span>
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
          <OddsBar result={result} height={12} labels={false} />
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

      {actual ? <ActualLine actual={actual} matched={matched} /> : null}
    </div>
  );
}

function ActualLine({ actual, matched, compact }: { actual: NonNullable<BattleState['actual']>; matched?: boolean; compact?: boolean }) {
  return (
    <div className={clsx('tl-sim__actual', `is-${actual.result}`, compact && 'is-compact')}>
      <Gem tone={actual.result === 'won' ? 'win' : actual.result === 'lost' ? 'loss' : 'tie'} size={10} />
      <span className="tl-sim__actual-value">
        {actual.result === 'won' ? 'Won' : actual.result === 'lost' ? 'Lost' : 'Tied'}
        {actual.damage ? ` · ${actual.result === 'lost' ? 'took' : 'dealt'} ${actual.damage}` : ''}
      </span>
      {matched !== undefined ? (
        <span className={clsx('tl-sim__match', matched ? 'is-yes' : 'is-no')}>
          {matched ? <CheckIcon size={12} /> : <CrossIcon size={11} />}
          {compact ? (matched ? 'Called it' : 'Upset') : matched ? 'As predicted' : 'Upset'}
        </span>
      ) : null}
    </div>
  );
}

/** Recruit phase: the previous combat, compact, foldable to a small badge. */
function LastBattle({ handle }: { handle: HandleProps }) {
  const game = useApp((s) => s.game)!;
  const { battle, result, oppHero, oppName, matched } = useBattleInfo(game);
  const [folded, setFolded] = useState(readFolded);
  useEffect(() => {
    try {
      sessionStorage.setItem(FOLD_KEY, folded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [folded]);
  const actual = battle.actual;
  const actualTone = actual ? (actual.result === 'won' ? 'win' : actual.result === 'lost' ? 'loss' : 'tie') : undefined;

  if (folded) {
    return (
      <div className="tl-panel tl-sim is-folded" title={`Last battle · turn ${battle.turn}`}>
        <DragHandle handle={handle} />
        <span className="tl-sim__crest is-small">
          <SwordsIcon size={11} />
        </span>
        <span className="tl-sim__turn">T{battle.turn}</span>
        {result ? (
          <span className="tl-sim__foldodds">
            <Gem tone="win" size={9} />
            {pct(result.win, 0)}
          </span>
        ) : null}
        {actual ? (
          <span className={clsx('tl-sim__foldres', `is-${actual.result}`)}>
            <Gem tone={actualTone!} size={9} />
            {actual.result === 'won' ? 'W' : actual.result === 'lost' ? 'L' : 'T'}
            {matched !== undefined ? matched ? <CheckIcon size={11} className="tl-up" /> : <CrossIcon size={10} className="tl-down" /> : null}
          </span>
        ) : null}
        <button className="tl-sim__fold" onClick={() => setFolded(false)} title="Show the last battle">
          <ChevronIcon size={12} dir="down" />
        </button>
      </div>
    );
  }

  return (
    <div className="tl-panel tl-sim is-compact">
      <div className="tl-sim__head">
        <DragHandle handle={handle} />
        <span className="tl-sim__crest is-small">
          <SwordsIcon size={12} />
        </span>
        <span className="tl-sim__title">
          Last battle <span className="tl-sim__turn">Turn {battle.turn}</span>
        </span>
        {oppHero ? (
          <span className="tl-sim__vs">
            <span className="tl-sim__vsword">vs</span>
            <HeroPortrait cardId={oppHero} size={20} />
            <span className="tl-sim__opp">{oppName}</span>
          </span>
        ) : null}
        <button className="tl-sim__fold" onClick={() => setFolded(true)} title="Fold to a small badge">
          <ChevronIcon size={12} dir="up" />
        </button>
      </div>
      {result ? (
        <div className="tl-sim__mini">
          <span className="tl-sim__minicol is-win">
            <Gem tone="win" size={10} />
            <b>{pct(result.win)}</b> win
          </span>
          <span className="tl-sim__minicol is-tie">
            <Gem tone="tie" size={9} />
            <b>{pct(result.tie)}</b> tie
          </span>
          <span className="tl-sim__minicol is-loss">
            <Gem tone="loss" size={10} />
            <b>{pct(result.loss)}</b> loss
          </span>
        </div>
      ) : (
        <div className="tl-sim__mini tl-muted">No simulation for this combat</div>
      )}
      {result ? <OddsBar result={result} height={7} labels={false} /> : null}
      {actual ? <ActualLine actual={actual} matched={matched} compact /> : <div className="tl-sim__mini tl-muted">Result not recorded</div>}
    </div>
  );
}
