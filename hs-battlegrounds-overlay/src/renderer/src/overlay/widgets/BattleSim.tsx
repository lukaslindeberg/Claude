import clsx from 'clsx';
import type { BattleSimResult, BattleState, BgGameState } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useCurrentSim } from '../../hooks/useBattleSim';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { OddsBar, ResultChip } from '../../components/Bits';
import { WarningIcon } from '../../components/Icons';
import { Tooltip } from '../../components/Tooltip';
import { num } from '../../lib/format';
import { predictedOutcome } from '../../lib/stats';
import { DragHandle, FloatingWidget, type HandleProps } from '../Widget';
import { battleSimPlacement, effectiveScale } from '../layout';

/**
 * During combat: the odds for this fight. Through the following shop phase the same
 * plaque stays as "Last battle" (odds and the actual result) until the next combat
 * replaces it; hero selection, trinket offers and game over hide it.
 */
function useBattleView(): 'combat' | 'last' | null {
  const phase = useApp((s) => s.game?.phase);
  const battle = useApp((s) => s.game?.battle);
  // A trinket offer takes the top of the screen (the trinket pick cards sit there).
  const trinketPick = useApp((s) => !!s.game?.trinketOptions?.length && s.settings.widgets.trinketPick !== false && !s.hidden.trinketPick);
  if (phase === 'combat') return 'combat';
  if (phase === 'recruit' && trinketPick) return null;
  if (phase === 'recruit' && battle && battle.turn > 0 && (battle.input || battle.result || battle.actual)) return 'last';
  return null;
}

export function BattleSimWidget() {
  const view = useBattleView();
  const settingsScale = useApp((s) => s.settings.scale);
  const saved = useApp((s) => !!s.settings.positions?.battleSim);
  const vp = useViewport();
  const scale = effectiveScale(settingsScale, vp);
  const place = battleSimPlacement(view ?? 'combat', vp, scale);
  if (!view) return null;
  return (
    <FloatingWidget
      id="battleSim"
      // A plaque the user placed keeps the overlay scale.
      scale={saved || place.scale === scale ? undefined : place.scale}
      defaultPosition={(_vp, size) => ({ left: place.right - size.width, top: place.top })}
    >
      {(handle) => <BattlePlaque handle={handle} view={view} />}
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
  /** Duos: the other member of the opposing team (fights after / before `oppHero`). */
  oppMateHero?: string;
  oppMateName?: string;
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
  // Duos: you fight both members of the other team; the sim input carries the second board.
  let oppMateHero: string | undefined;
  let oppMateName: string | undefined;
  if (game.mode === 'duos') {
    const mateId = opp?.teamId !== undefined ? game.players.find((p) => p.teamId === opp.teamId && p.playerId !== opp.playerId)?.playerId : undefined;
    const inputMate = battle.input?.opponent.playerId === oppId ? battle.input?.opponent.teammate : battle.input?.opponent;
    const mate = game.players.find((p) => p.playerId === (mateId ?? inputMate?.playerId));
    oppMateHero = mate?.heroCardId ?? inputMate?.heroCardId;
    oppMateName = mate?.heroName ?? (oppMateHero ? db.name(oppMateHero) : undefined);
  }
  return {
    battle,
    result,
    status,
    preliminary: !!result && !!run && run.status !== 'done' && !battle.result,
    error: run?.error ?? battle.error,
    oppHero,
    oppName: opp?.heroName ?? (oppHero ? db.name(oppHero) : undefined),
    oppMateHero,
    oppMateName,
  };
}

const whole = (v: number) => `${v > 0 && v < 1 ? '<1' : v > 99 && v < 100 ? '>99' : Math.round(v)}%`;

/**
 * One compact plaque: win / tie / loss, expected damage, lethal chances (only when there
 * are any) and the actual result. When the boards contain effects the simulator does not
 * model, the odds are shown greyed out behind an "Unreliable" line instead of as
 * confident numbers.
 */
function BattlePlaque({ handle, view }: { handle: HandleProps; view: 'combat' | 'last' }) {
  const game = useApp((s) => s.game)!;
  const db = useApp((s) => s.cardDb);
  const { battle, result, status, preliminary, error, oppHero, oppName, oppMateHero, oppMateName } = useBattleInfo(game);
  const title = oppName && oppMateName ? `${oppName} & ${oppMateName}` : oppName;
  // Names come from card data; cards missing from it (older patches) fall back to the name in the log.
  const logNames = new Map<string, string>();
  for (const side of [battle.input?.player, battle.input?.opponent, battle.input?.player.teammate, battle.input?.opponent.teammate]) {
    for (const m of [...(side?.minions ?? []), ...(side?.hand ?? [])]) if (m.name) logNames.set(m.cardId, m.name);
  }
  const unsupported = result?.unsupported?.length ? [...new Set(result.unsupported.map((id) => db.name(db.normalOf(id), logNames.get(id))))] : [];
  const unreliable = unsupported.length > 0;
  const actual = battle.actual;
  const matched = actual && result && !unreliable ? actual.result === predictedOutcome(result) : undefined;
  const approx = unreliable ? '~' : '';
  const note =
    status === 'running' && !result
      ? 'Simulating…'
      : preliminary
        ? status === 'error'
          ? 'Quick estimate'
          : 'Refining…'
        : status === 'error' && !result
          ? 'Simulator error'
          : status === 'waiting' && !result
            ? 'Waiting for boards'
            : undefined;

  return (
    <div className={clsx('tl-panel tl-sim', unreliable && 'is-unreliable', status === 'running' && 'is-running')}>
      <div className="tl-sim__head">
        <DragHandle handle={handle} />
        {oppHero ? (
          <span className={clsx('tl-sim__heroes', oppMateHero && 'is-duo')}>
            <HeroPortrait cardId={oppHero} size={oppMateHero ? 22 : 26} />
            {oppMateHero ? <HeroPortrait cardId={oppMateHero} size={22} /> : null}
          </span>
        ) : null}
        <span className="tl-sim__title" title={title}>
          {view === 'last' ? 'Last battle' : title ? `vs ${title}` : 'Battle'}
        </span>
        <span className="tl-sim__turn" title={note === 'Simulator error' ? error : undefined}>
          {note ?? `Turn ${battle.turn || game.turn}`}
        </span>
      </div>
      {result ? (
        <Tooltip
          as="div"
          placement="bottom"
          content={
            <div className="tl-simtip">
              <div>
                {result.iterations.toLocaleString()} simulated combats in {(result.durationMs / 1000).toFixed(1)} s
              </div>
              <div>
                Win {result.win.toFixed(1)}% · tie {result.tie.toFixed(1)}% · loss {result.loss.toFixed(1)}%
              </div>
              {unreliable ? <div>These odds ignore effects the simulator does not model, so they can be far off.</div> : null}
            </div>
          }
        >
          <div className="tl-sim__odds">
            <div className="tl-sim__figs">
              <span className="tl-sim__fig is-win">
                <b>
                  {approx}
                  {whole(result.win)}
                </b>
                win
              </span>
              <span className="tl-sim__fig is-tie">
                <b>{whole(result.tie)}</b>
                tie
              </span>
              <span className="tl-sim__fig is-loss">
                <b>
                  {approx}
                  {whole(result.loss)}
                </b>
                loss
              </span>
            </div>
            <OddsBar result={result} height={9} labels={false} />
          </div>
        </Tooltip>
      ) : (
        <div className="tl-sim__odds is-empty">
          <span className="tl-sim__placeholder" />
        </div>
      )}
      {unreliable ? (
        <Tooltip
          as="div"
          placement="bottom"
          content={
            <div className="tl-simtip">
              <div className="tl-cardtip__name">Not simulated</div>
              <ul>
                {unsupported.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          }
        >
          <div className="tl-sim__warn">
            <WarningIcon size={12} />
            Unreliable: {unsupported.length} effect{unsupported.length === 1 ? '' : 's'} not simulated
          </div>
        </Tooltip>
      ) : null}
      {result || actual ? (
        <div className="tl-sim__foot">
          {result ? (
            <span className="tl-sim__dmg" title="Average damage dealt when you win / taken when you lose">
              <b className="is-win">+{num(result.avgDamageDealt)}</b>
              <i>/</i>
              <b className="is-loss">−{num(result.avgDamageTaken)}</b>
              <span>dmg</span>
            </span>
          ) : null}
          {result && !unreliable && (result.lethalWin > 0 || result.lethalLoss > 0) ? (
            <span className="tl-sim__lethal" title="Chance this combat kills the opponent / you">
              lethal
              {result.lethalWin > 0 ? <b className="is-win">{whole(result.lethalWin)}</b> : null}
              {result.lethalLoss > 0 ? <b className="is-loss">{whole(result.lethalLoss)}</b> : null}
            </span>
          ) : null}
          {actual ? (
            <span className="tl-sim__actual" title={matched === undefined ? 'Actual result' : matched ? 'As predicted' : 'Not the likeliest outcome'}>
              <ResultChip result={actual.result} damage={actual.damage} />
              {matched !== undefined ? <i className={matched ? 'is-hit' : 'is-miss'}>{matched ? '✓' : '✗'}</i> : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
