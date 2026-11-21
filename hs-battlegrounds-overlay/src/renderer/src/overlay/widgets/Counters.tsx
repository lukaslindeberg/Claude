import type { ReactNode } from 'react';
import { useApp } from '../../store/appStore';
import { Tooltip } from '../../components/Tooltip';
import { BeetleIcon, BloodGemIcon, CoinIcon, RefreshIcon } from '../../components/Icons';
import { DragHandle, FloatingWidget } from '../Widget';
import { countersPlacement } from '../layout';

interface Chip {
  key: string;
  icon: ReactNode;
  value: string;
  tip: string;
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
  const visible = useApp((s) => {
    const g = s.game;
    return !!g && g.active && g.phase !== 'idle' && g.phase !== 'heroSelection' && g.phase !== 'gameOver' && !g.trinketOptions?.length;
  });
  if (!visible || !c) return null;
  const chips: Chip[] = [];
  if (c.bloodGem)
    chips.push({ key: 'gem', icon: <BloodGemIcon size={14} />, value: `+${c.bloodGem.attack}/+${c.bloodGem.health}`, tip: `Each Blood Gem gives +${c.bloodGem.attack}/+${c.bloodGem.health}.`, tone: 'is-gem' });
  if (c.beetle) chips.push({ key: 'beetle', icon: <BeetleIcon size={14} />, value: `${c.beetle.attack}/${c.beetle.health}`, tip: `Your Beetles are summoned as ${c.beetle.attack}/${c.beetle.health}.`, tone: 'is-beetle' });
  const gold = (c.extraGoldNextTurn ?? 0) - (c.overdrawnGoldNextTurn ?? 0);
  if (c.extraGoldNextTurn || c.overdrawnGoldNextTurn)
    chips.push({
      key: 'gold',
      icon: <CoinIcon size={14} />,
      value: gold > 0 ? `+${gold}` : gold < 0 ? `−${-gold}` : '±0',
      tip: gold < 0 ? `Overdrawn: ${-gold} less Gold next turn.` : gold > 0 ? `${gold} extra Gold next turn.` : 'Extra and overdrawn Gold next turn cancel out.',
      tone: gold < 0 ? 'is-gold is-neg' : 'is-gold',
    });
  if (c.freeRefreshes) chips.push({ key: 'refresh', icon: <RefreshIcon size={13} />, value: String(c.freeRefreshes), tip: `${c.freeRefreshes} free Refresh${c.freeRefreshes === 1 ? '' : 'es'} left this turn.`, tone: 'is-refresh' });
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
