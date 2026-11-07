import { useEffect, useRef } from 'react';
import type { WidgetId } from '@shared/types';
import { useApp } from '../store/appStore';
import { useBattleSimRunner } from '../hooks/useBattleSim';
import { useViewport } from '../hooks/useViewport';
import { WidgetBoundary } from '../components/WidgetBoundary';
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

/**
 * Hotkeys dismiss the post-match summary: toggling the overlay (settings.overlayEnabled)
 * or any widget hotkey while it is showing. The summary must never be stuck on screen.
 */
function useHotkeyDismissPostMatch() {
  const overlayEnabled = useApp((s) => s.settings.overlayEnabled);
  const pulses = useApp((s) => s.togglePulse);
  const prev = useRef({ overlayEnabled, pulses });
  useEffect(() => {
    const p = prev.current;
    prev.current = { overlayEnabled, pulses };
    if (p.overlayEnabled === overlayEnabled && p.pulses === pulses) return;
    const { game, dismissedPostMatch, dismissPostMatch } = useApp.getState();
    if (game?.phase === 'gameOver' && dismissedPostMatch !== game.gameId) dismissPostMatch(game.gameId);
  }, [overlayEnabled, pulses]);
}

export default function OverlayApp() {
  const demo = useApp((s) => s.demo);
  const settings = useApp((s) => s.settings);
  const hidden = useApp((s) => s.hidden);
  useThemeVars();
  useBattleSimRunner();
  useHotkeyDismissPostMatch();

  const on = (id: WidgetId) => settings.widgets[id] !== false && !hidden[id];
  return (
    <div className="tl-overlay-root">
      {demo ? <DemoBackdrop /> : null}
      {settings.overlayEnabled ? (
        <>
          {/* Each widget has its own error boundary: one crash never blanks the overlay. */}
          {on('leaderboardHover') || settings.leaderboardCalibrationMode ? <WidgetBoundary id="leaderboardHover"><LeaderboardHover /></WidgetBoundary> : null}
          {on('heroSelection') ? <WidgetBoundary id="heroSelection"><HeroSelectionWidget /></WidgetBoundary> : null}
          {on('sessionStats') ? <WidgetBoundary id="sessionStats"><SessionWidget /></WidgetBoundary> : null}
          {on('lobbyInfo') ? <WidgetBoundary id="lobbyInfo"><LobbyInfoWidget /></WidgetBoundary> : null}
          {on('opponentsPanel') ? <WidgetBoundary id="opponentsPanel"><OpponentsPanel /></WidgetBoundary> : null}
          {on('battleSim') ? <WidgetBoundary id="battleSim"><BattleSimWidget /></WidgetBoundary> : null}
          {on('tierList') ? <WidgetBoundary id="tierList"><TierListWidget /></WidgetBoundary> : null}
          {on('postMatch') ? <WidgetBoundary id="postMatch"><PostMatchWidget /></WidgetBoundary> : null}
        </>
      ) : null}
    </div>
  );
}
