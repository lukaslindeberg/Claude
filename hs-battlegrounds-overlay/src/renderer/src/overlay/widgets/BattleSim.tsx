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
import { useViewport } from '../../hooks/useViewport';
import { DragHandle, FloatingWidget, type HandleProps } from '../Widget';
import { battleSimPlacement, effectiveScale } from '../layout';

/** Fold choice per view (session only). Unset = automatic (folded only when it doesn't fit). */
const FOLD_KEYS = { combat: 'tl-battlesim-folded-combat', last: 'tl-battlesim-folded' } as const;

function readFold(view: 'combat' | 'last'): boolean | undefined {
  try {
    const v = sessionStorage.getItem(FOLD_KEYS[view]);
    return v === '1' ? true : v === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}

/** The user's fold choice for this view, falling back to `auto`. */
function useFold(view: 'combat' | 'last', auto: boolean): [boolean, (v: boolean) => void] {
  const [choice, setChoice] = useState<boolean | undefined>(() => readFold(view));
  useEffect(() => setChoice(readFold(view)), [view]);
  const set = (v: boolean) => {
    setChoice(v);
    try {
      sessionStorage.setItem(FOLD_KEYS[view], v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return [choice ?? auto, set];
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
  const saved = useApp((s) => !!s.settings.positions?.battleSim);
  const tierBar = useApp((s) => s.settings.widgets.tierList !== false && !s.hidden.tierList && !s.settings.positions?.tierList);
  const oppPanel = useApp((s) => s.settings.widgets.opponentsPanel !== false && !s.hidden.opponentsPanel);
  const vp = useViewport();
  const scale = effectiveScale(settingsScale, vp);
  const place = battleSimPlacement(view ?? 'combat', vp, scale, { tierBar, oppPanel });
  // A plaque the user placed keeps the overlay scale and stays unfolded unless folded by hand.
  const autoFold = !saved && place.fold;
  const [folded, setFolded] = useFold(view ?? 'combat', autoFold);
  if (!view) return null;
  const zoom = saved ? scale : folded ? place.foldedScale : place.scale;
  return (
    <FloatingWidget
      id="battleSim"
      scale={zoom === scale ? undefined : zoom}
      defaultPosition={(_vp, size) => ({ left: place.right - size.width, top: place.top })}
    >
      {(handle) =>
        folded ? (
          <FoldedBattle handle={handle} view={view} onUnfold={() => setFolded(false)} />
        ) : view === 'combat' ? (
          <BattleSimPanel handle={handle} onFold={() => setFolded(true)} />
        ) : (
          <LastBattle handle={handle} onFold={() => setFolded(true)} />
        )
      }
    </FloatingWidget>
  );
}

interface BattleInfo {
  battle: BattleState;
  result?: BattleSimResult;
  status: 'running' | 'done' | 'error' | 'waiting';
  /** The result is the quick first pass (the full run is still going, or failed). */
  preliminary: boolean;
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
    preliminary: !!result && !!run && run.status !== 'done' && !battle.result,
    error: run?.error ?? battle.error,
    oppHero,
    oppName: opp?.heroName ?? (oppHero ? db.name(oppHero) : undefined),
    matched: battle.actual && predicted ? battle.actual.result === predicted : undefined,
  };
}

function statusText({ status, result, preliminary, error }: BattleInfo): { text: string; title?: string } {
  if (result && preliminary) {
    return status === 'error'
      ? { text: `Quick estimate · ${result.iterations.toLocaleString()} sims`, title: `The full simulation failed: ${error ?? 'unknown error'}` }
      : { text: `Preliminary · ${result.iterations.toLocaleString()} sims`, title: 'Quick first pass; the full simulation is still running' };
  }
  if (status === 'running') return { text: 'Simulating…' };
  if (status === 'done' && result) return { text: `${result.iterations.toLocaleString()} sims · ${(result.durationMs / 1000).toFixed(1)}s` };
  if (status === 'error') return { text: 'Simulator error', title: error };
  return { text: 'Waiting for boards' };
}

function BattleSimPanel({ handle, onFold }: { handle: HandleProps; onFold: () => void }) {
  const game = useApp((s) => s.game)!;
  const db = useApp((s) => s.cardDb);
  const info = useBattleInfo(game);
  const { battle, result, status, preliminary, error, oppHero, oppName, matched } = info;
  // Names come from card data; cards missing from it (older patches) fall back to the name in the log.
  const logNames = new Map<string, string>();
  for (const side of [battle.input?.player, battle.input?.opponent]) {
    for (const m of [...(side?.minions ?? []), ...(side?.hand ?? [])]) if (m.name) logNames.set(m.cardId, m.name);
  }
  const unsupported = result?.unsupported?.length
    ? [...new Set(result.unsupported.map((id) => db.name(db.normalOf(id), logNames.get(id))))]
    : [];
  const actual = battle.actual;
  const st = statusText(info);

  return (
    <div className={clsx('tl-panel tl-sim', status === 'running' && 'is-running', preliminary && 'is-prelim')}>
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
            <span className="tl-sim__opp" title={oppName}>
              {oppName}
            </span>
          </span>
        ) : null}
        <span className="tl-sim__status" title={st.title}>
          {preliminary ? <i className="tl-sim__pulse" /> : null}
          {st.text}
        </span>
        <button className="tl-sim__fold" onClick={onFold} title="Fold to a small badge">
          <ChevronIcon size={12} dir="up" />
        </button>
      </div>

      {/* The odds block keeps one height through waiting → preliminary → full result. */}
      <div className="tl-sim__odds">
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
      </div>

      {unsupported.length ? (
        <div className="tl-sim__warn" title={unsupported.join(', ')}>
          <WarningIcon size={12} />
          <span>
            Approximate — not fully simulated: <b>{unsupported.slice(0, 4).join(', ')}</b>
            {unsupported.length > 4 ? ` +${unsupported.length - 4} more` : ''}
          </span>
        </div>
      ) : null}

      {/* Reserved row: the result replaces the placeholder in place (no jump). */}
      {actual ? <ActualLine actual={actual} matched={matched} /> : <div className="tl-sim__actual is-pending">Result after the fight</div>}
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

/** Folded badge (either view): turn, win odds and the actual result. */
function FoldedBattle({ handle, view, onUnfold }: { handle: HandleProps; view: 'combat' | 'last'; onUnfold: () => void }) {
  const game = useApp((s) => s.game)!;
  const { battle, result, preliminary, matched } = useBattleInfo(game);
  const actual = battle.actual;
  const actualTone = actual ? (actual.result === 'won' ? 'win' : actual.result === 'lost' ? 'loss' : 'tie') : undefined;
  const turn = battle.turn || game.turn;
  return (
    <div className={clsx('tl-panel tl-sim is-folded', preliminary && 'is-prelim')} title={`${view === 'combat' ? 'Battle' : 'Last battle'} · turn ${turn}`}>
      <DragHandle handle={handle} />
      <span className="tl-sim__crest is-small">
        <SwordsIcon size={11} />
      </span>
      <span className="tl-sim__turn">T{turn}</span>
      {result ? (
        <span className="tl-sim__foldodds" title={preliminary ? 'Preliminary odds' : undefined}>
          <Gem tone="win" size={9} />
          {pct(result.win, 0)}
        </span>
      ) : view === 'combat' ? (
        <span className="tl-sim__foldodds tl-muted">…</span>
      ) : null}
      {actual ? (
        <span className={clsx('tl-sim__foldres', `is-${actual.result}`)}>
          <Gem tone={actualTone!} size={9} />
          {actual.result === 'won' ? 'W' : actual.result === 'lost' ? 'L' : 'T'}
          {matched !== undefined ? matched ? <CheckIcon size={11} className="tl-up" /> : <CrossIcon size={10} className="tl-down" /> : null}
        </span>
      ) : null}
      <button className="tl-sim__fold" onClick={onUnfold} title={view === 'combat' ? 'Show the battle odds' : 'Show the last battle'}>
        <ChevronIcon size={12} dir="down" />
      </button>
    </div>
  );
}

/** Recruit phase: the previous combat, compact, foldable to a small badge. */
function LastBattle({ handle, onFold }: { handle: HandleProps; onFold: () => void }) {
  const game = useApp((s) => s.game)!;
  const { battle, result, preliminary, oppHero, oppName, matched } = useBattleInfo(game);
  const actual = battle.actual;

  return (
    <div className={clsx('tl-panel tl-sim is-compact', preliminary && 'is-prelim')}>
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
            <span className="tl-sim__opp" title={oppName}>
              {oppName}
            </span>
          </span>
        ) : null}
        <button className="tl-sim__fold" onClick={onFold} title="Fold to a small badge">
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
