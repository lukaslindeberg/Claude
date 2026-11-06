import { useEffect } from 'react';
import type { WidgetId } from '@shared/types';
import { useApp } from '../store/appStore';
import { useBattleSimRunner } from '../hooks/useBattleSim';
import { useViewport } from '../hooks/useViewport';
import { effectiveScale } from './layout';
import { DemoBackdrop } from './DemoBackdrop';
import { HeroSelectionWidget } from './widgets/HeroSelection';
import { OpponentsPanel } from './widgets/OpponentsPanel';
import { LeaderboardHover } from './widgets/LeaderboardHover';
import { BattleSimWidget } from './widgets/BattleSim';
import { TierListWidget } from './widgets/TierList';
import { LobbyInfoWidget } from './widgets/LobbyInfo';
import { PostMatchWidget } from './widgets/PostMatch';
import { SessionWidget } from './widgets/SessionWidget';
import '../styles/overlay.css';

/** Applies scale/opacity settings as CSS variables on :root (tooltips are portalled). */
function useThemeVars() {
  const scale = useApp((s) => s.settings.scale);
  const opacity = useApp((s) => s.settings.opacity);
  const vp = useViewport();
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--tl-scale', String(effectiveScale(scale, vp)));
    root.setProperty('--tl-alpha', String(Math.max(0.3, Math.min(1, opacity ?? 0.92))));
  }, [scale, opacity, vp]);
}

export default function OverlayApp() {
  const demo = useApp((s) => s.demo);
  const settings = useApp((s) => s.settings);
  const hidden = useApp((s) => s.hidden);
  useThemeVars();
  useBattleSimRunner();

  const on = (id: WidgetId) => settings.widgets[id] !== false && !hidden[id];
  return (
    <div className="tl-overlay-root">
      {demo ? <DemoBackdrop /> : null}
      {settings.overlayEnabled ? (
        <>
          {on('leaderboardHover') || settings.leaderboardCalibrationMode ? <LeaderboardHover /> : null}
          {on('heroSelection') ? <HeroSelectionWidget /> : null}
          {on('sessionStats') ? <SessionWidget /> : null}
          {on('lobbyInfo') ? <LobbyInfoWidget /> : null}
          {on('opponentsPanel') ? <OpponentsPanel /> : null}
          {on('battleSim') ? <BattleSimWidget /> : null}
          {on('tierList') ? <TierListWidget /> : null}
          {on('postMatch') ? <PostMatchWidget /> : null}
        </>
      ) : null}
    </div>
  );
}
