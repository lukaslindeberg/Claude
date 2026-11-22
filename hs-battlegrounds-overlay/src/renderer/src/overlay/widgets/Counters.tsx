import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BgApm } from '@shared/types';
import { useApp } from '../../store/appStore';
import { Tooltip } from '../../components/Tooltip';
import { BeetleIcon, BloodGemIcon, ClockIcon, CoinIcon, RefreshIcon } from '../../components/Icons';
import { DragHandle, FloatingWidget } from '../Widget';
import { ApmChart } from '../../components/ApmChart';
import { countersPlacement } from '../layout';

interface Chip {
  key: string;
  icon: ReactNode;
  value: string;
  tip: ReactNode;
  tone?: string;
}

/**
 * A small panel of counters for the local player beside the game's refresh button: Blood
 * Gem and Beetle stats (when those cards are in play), gold next turn and free refreshes
 * (when non-zero). Hidden when there is nothing to count, at hero pick, during a trinket
 * offer (which covers the top of the board) and after the game.
 */
export function CountersWidget() {
  const c = useApp((s) => s.game?.counters);
  const apm = useApp((s) => s.game?.apm);
  const apmChip = useApmChip(apm);
  const visible = useApp((s) => {
    const g = s.game;
    return !!g && g.active && g.phase !== 'idle' && g.phase !== 'heroSelection' && g.phase !== 'gameOver' && !g.trinketOptions?.length;
  });
  if (!visible || (!c && !apmChip)) return null;
  const chips: Chip[] = [];
  if (apmChip) chips.push(apmChip);
  if (c?.bloodGem)
    chips.push({ key: 'gem', icon: <BloodGemIcon size={14} />, value: `+${c.bloodGem.attack}/+${c.bloodGem.health}`, tip: `Each Blood Gem gives +${c.bloodGem.attack}/+${c.bloodGem.health}.`, tone: 'is-gem' });
  if (c?.beetle) chips.push({ key: 'beetle', icon: <BeetleIcon size={14} />, value: `${c.beetle.attack}/${c.beetle.health}`, tip: `Your Beetles are summoned as ${c.beetle.attack}/${c.beetle.health}.`, tone: 'is-beetle' });
  const gold = (c?.extraGoldNextTurn ?? 0) - (c?.overdrawnGoldNextTurn ?? 0);
  if (c?.extraGoldNextTurn || c?.overdrawnGoldNextTurn)
    chips.push({
      key: 'gold',
      icon: <CoinIcon size={14} />,
      value: gold > 0 ? `+${gold}` : gold < 0 ? `−${-gold}` : '±0',
      tip: gold < 0 ? `Overdrawn: ${-gold} less Gold next turn.` : gold > 0 ? `${gold} extra Gold next turn.` : 'Extra and overdrawn Gold next turn cancel out.',
      tone: gold < 0 ? 'is-gold is-neg' : 'is-gold',
    });
  if (c?.freeRefreshes) chips.push({ key: 'refresh', icon: <RefreshIcon size={13} />, value: String(c.freeRefreshes), tip: `${c.freeRefreshes} free Refresh${c.freeRefreshes === 1 ? '' : 'es'} left this turn.`, tone: 'is-refresh' });
  if (!chips.length) return null;
  return (
    <FloatingWidget id="counters" defaultPosition={countersPlacement} zIndex={22}>
      {(handle) => (
        <div className="tl-panel tl-counters">
          <DragHandle handle={handle} />
          {chips.map((ch) => (
            <Tooltip key={ch.key} placement="bottom" content={<div>{ch.tip}</div>}>
              <span className={`tl-counter ${ch.tone ?? ''}`}>
                {ch.icon}
                <b>{ch.value}</b>
              </span>
            </Tooltip>
          ))}
        </div>
      )}
    </FloatingWidget>
  );
}

const fmtTime = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const perMinute = (actions: number, ms: number) => (ms >= 5000 ? Math.round((actions * 60000) / ms) : undefined);

/**
 * APM chip: this shop phase's actions per minute, live (the shop's length is measured here,
 * from when the overlay saw it open); after the shop, the last shop phase's. Hover: details
 * and the game average.
 */
function useApmChip(apm: BgApm | undefined): Chip | undefined {
  const opened = useRef<{ turn: number; at: number } | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const inShop = !!apm?.inShop;
  if (apm && inShop && opened.current?.turn !== apm.turn) opened.current = { turn: apm.turn, at: Date.now() };
  useEffect(() => {
    if (!inShop) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [inShop]);
  if (!apm) return undefined;
  const liveMs = inShop && opened.current ? Math.max(0, now - opened.current.at) : 0;
  const turn = inShop ? { actions: apm.turnActions, ms: liveMs } : apm.last;
  if (!turn) return undefined;
  const value = perMinute(turn.actions, turn.ms);
  const gameMs = apm.pastMs + (inShop ? liveMs : 0);
  const gameActions = apm.pastActions + (inShop ? apm.turnActions : 0);
  const game = perMinute(gameActions, gameMs);
  const label = inShop ? 'This shop' : `Turn ${apm.last?.turn ?? apm.turn} shop`;
  const history = [...(apm.history ?? []), ...(inShop && turn.ms >= 5000 ? [{ turn: apm.turn, actions: turn.actions, ms: turn.ms }] : [])];
  return {
    key: 'apm',
    icon: <ClockIcon size={13} />,
    value: value === undefined ? '…' : `${value}`,
    tip: (
      <div className="tl-apmtip">
        <div>
          {label}: {turn.actions} action{turn.actions === 1 ? '' : 's'} in {fmtTime(turn.ms)}
          {value === undefined ? '' : ` (${value} APM)`}.{game === undefined ? '' : ` Game average: ${game} APM.`}
        </div>
        {history.length > 1 ? <ApmChart turns={history} width={240} height={70} /> : null}
        <div className="tl-muted tl-small">Counts buys, sells, plays, Refreshes, Freezes, level-ups and Hero Power.</div>
      </div>
    ),
    tone: 'is-apm',
  };
}
