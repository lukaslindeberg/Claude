import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { DEFAULT_SETTINGS, type Settings, type WidgetId } from '@shared/types';
import { useApp, type UiSettings } from '../../store/appStore';
import { Toggle } from '../../components/Bits';
import { Card, SectionHeader } from '../ui';

const WIDGETS: { id: WidgetId; label: string; hint: string }[] = [
  { id: 'heroSelection', label: 'Hero pick ranking', hint: 'Ranks the offered heroes for this lobby, with tribe effects and how to play them.' },
  { id: 'trinketPick', label: 'Trinket pick ranking', hint: 'Ranks the offered trinkets, warns when their tribe is missing, and how to play them.' },
  { id: 'opponentsPanel', label: 'Opponents panel', hint: 'Right-edge list of every player with their last seen board.' },
  { id: 'battleSim', label: 'Battle odds', hint: 'Win / tie / loss odds for each combat, flagged when they are unreliable.' },
  { id: 'lobbyInfo', label: 'Lobby info', hint: 'Turn, lobby tribes, your hero\'s expected placement and the anomaly.' },
  { id: 'tierPace', label: 'Tier-up timing', hint: 'On the lobby plaque: your tavern tier against when your own top-4 games usually reach it. Needs Lobby info.' },
  { id: 'counters', label: 'Counters', hint: 'Blood Gem and Beetle stats, gold next turn and free refreshes, next to the refresh button.' },
  { id: 'sessionStats', label: 'Session tracker', hint: 'Games today and recent placements, on the same plaque.' },
  { id: 'postMatch', label: 'Post-match summary', hint: 'Placement, final board and combat timeline after each game.' },
];

const HOTKEYS: { key: keyof Settings['hotkeys']; label: string }[] = [
  { key: 'toggleOverlay', label: 'Show / hide overlay' },
  { key: 'toggleOpponents', label: 'Collapse opponents panel' },
];

export function SettingsSection() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const status = useApp((s) => s.status);
  const bridge = useApp((s) => s.bridge);
  const set = (patch: Partial<UiSettings>) => void update(patch);

  return (
    <div className="tl-section">
      <SectionHeader title="Settings" subtitle="Changes apply immediately to the overlay." />
      <div className="tl-settings">
        <Card title="Overlay" extra={<Toggle checked={settings.overlayEnabled} onChange={(v) => set({ overlayEnabled: v })} label="Enabled" />}>
          <div className={clsx('tl-settings__widgets', !settings.overlayEnabled && 'is-disabled')}>
            {WIDGETS.map((w) => (
              <Toggle
                key={w.id}
                checked={settings.widgets[w.id] !== false}
                disabled={!settings.overlayEnabled}
                onChange={(v) => set({ widgets: { ...settings.widgets, [w.id]: v } })}
                label={w.label}
                hint={w.hint}
              />
            ))}
          </div>
          <div className="tl-settings__row">
            <button className="tl-btn" onClick={() => set({ positions: {} })} disabled={!Object.keys(settings.positions ?? {}).length}>
              Reset widget positions
            </button>
            <span className="tl-muted tl-small">Drag widgets by their grip; double-click a grip to reset one.</span>
          </div>
        </Card>

        <Card title="Appearance">
          <Slider label="Scale" value={settings.scale} min={0.6} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ scale: v })} hint="Relative to the game window; 100% fits 1080p." />
          <Slider label="Panel opacity" value={settings.opacity} min={0.3} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ opacity: v })} />
          <Toggle checked={settings.cardImages} onChange={(v) => set({ cardImages: v })} label="Card images" hint="Load card art from HearthstoneJSON (text and colour fallbacks otherwise)." />
        </Card>

        <Card title="Behaviour">
          <div className="tl-settings__stack">
            <Toggle checked={settings.hideWhenUnfocused} onChange={(v) => set({ hideWhenUnfocused: v })} label="Hide when Hearthstone is not focused" />
            <Toggle checked={settings.communityStats} onChange={(v) => set({ communityStats: v })} label="Community hero stats" hint="Download aggregate hero placement data." />
            <Toggle checked={settings.launchOnStartup} onChange={(v) => set({ launchOnStartup: v })} label="Launch on system start-up" />
          </div>
        </Card>

        <Card title="Battle simulator">
          <Slider
            label="Simulations per combat"
            value={settings.simIterations}
            min={500}
            max={20000}
            step={500}
            format={(v) => v.toLocaleString()}
            onChange={(v) => set({ simIterations: v })}
            hint="More simulations are more precise but take longer; 4,000 is a good balance."
          />
          <RatingInput />
        </Card>

        <Card title="Hotkeys">
          <div className="tl-settings__stack">
            {HOTKEYS.map((h) => (
              <HotkeyRow key={h.key} label={h.label} value={settings.hotkeys[h.key]} mac={status?.platform === 'darwin'} onChange={(v) => set({ hotkeys: { ...settings.hotkeys, [h.key]: v } })} />
            ))}
          </div>
        </Card>

        <Card title="Hearthstone">
          <div className="tl-settings__path">
            <input className="tl-input" readOnly value={settings.hearthstonePath ?? status?.hearthstoneInstallPath ?? ''} placeholder="Detected automatically" />
            <button
              className="tl-btn"
              onClick={async () => {
                const p = await bridge?.pickHearthstonePath();
                if (p) set({ hearthstonePath: p });
              }}
            >
              Browse…
            </button>
            {settings.hearthstonePath ? (
              <button className="tl-btn tl-btn--ghost" onClick={() => set({ hearthstonePath: undefined })}>
                Auto-detect
              </button>
            ) : null}
          </div>
          <p className="tl-muted tl-small">{settings.hearthstonePath ? 'Using a custom install folder.' : 'Auto-detected from the Battle.net install.'}</p>
        </Card>

      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; hint?: string }) {
  // Local state keeps dragging smooth; commit on release.
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const pct = ((local - min) / (max - min)) * 100;
  return (
    <label className="tl-slider">
      <span className="tl-slider__head">
        <span className="tl-slider__label">{label}</span>
        <span className="tl-slider__value">{format(local)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => local !== value && onChange(local)}
        onKeyUp={() => local !== value && onChange(local)}
      />
      {hint ? <span className="tl-slider__hint">{hint}</span> : null}
    </label>
  );
}

function RatingInput() {
  const rating = useApp((s) => s.settings.manualRating);
  const update = useApp((s) => s.updateSettings);
  const [v, setV] = useState(rating ? String(rating) : '');
  useEffect(() => setV(rating ? String(rating) : ''), [rating]);
  return (
    <div className="tl-settings__field">
      <span className="tl-slider__label">Current rating</span>
      <input
        className="tl-input tl-settings__num"
        inputMode="numeric"
        placeholder="e.g. 6500"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => void update({ manualRating: v ? Number(v) : undefined })}
      />
      <span className="tl-muted tl-small">Optional; shown in the session tracker.</span>
    </div>
  );
}

function prettyKey(part: string, mac: boolean): string {
  if (part === 'CommandOrControl' || part === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl';
  if (part === 'Alt' || part === 'Option') return mac ? '⌥' : 'Alt';
  if (part === 'Shift') return mac ? '⇧' : 'Shift';
  return part;
}

function acceleratorFrom(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = e.key;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  else if (/^F\d{1,2}$/.test(key) || /^\d$/.test(key)) key = key.toUpperCase();
  else if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else {
    const map: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };
    key = map[key] ?? key;
  }
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null;
  return [...mods, key].join('+');
}

function HotkeyRow({ label, value, mac, onChange }: { label: string; value: string; mac: boolean; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!capturing) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        setCapturing(false);
        return;
      }
      const acc = acceleratorFrom(e);
      if (acc) {
        onChange(acc);
        setCapturing(false);
      }
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [capturing, onChange]);
  return (
    <div className="tl-hotkey">
      <span className="tl-hotkey__label">{label}</span>
      <span className={clsx('tl-hotkey__keys', capturing && 'is-capturing')}>
        {capturing ? (
          <span className="tl-muted">Press a key combination… (Esc to cancel)</span>
        ) : (
          value.split('+').map((p, i) => <kbd key={i}>{prettyKey(p, mac)}</kbd>)
        )}
      </span>
      <button className="tl-btn" onClick={() => setCapturing(!capturing)}>
        {capturing ? 'Cancel' : 'Change'}
      </button>
    </div>
  );
}
