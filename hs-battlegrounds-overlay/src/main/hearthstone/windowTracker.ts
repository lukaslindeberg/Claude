/**
 * Tracks the Hearthstone game window (found / focused / minimized / client bounds).
 *
 * - Windows: ONE persistent `powershell.exe` child compiling a tiny C# helper via
 *   Add-Type (user32: per-monitor DPI awareness, FindWindow("UnityWndClass","Hearthstone"),
 *   GetForegroundWindow, IsIconic, GetClientRect + ClientToScreen) that prints a
 *   JSON line every 250 ms. Physical px are converted to DIP by the injected
 *   `toDip` (Electron's `screen.screenToDipRect`). Restarted if it dies.
 * - macOS: polls `osascript` (System Events). Without Accessibility permission it
 *   falls back to "found (if the process runs), focused, no bounds" so the overlay
 *   covers the primary display.
 * - Other platforms: not supported (found=false); the app falls back to the
 *   primary display.
 *
 * No Electron imports (the DIP conversion is injected).
 */
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GameWindowInfo } from '@shared/types';
import { createLogger } from '../logger';

const log = createLogger('window-tracker');

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const NOT_FOUND: GameWindowInfo = { found: false, focused: false, minimized: false };

/** C# helper + loop, executed by PowerShell. `__PARENT_PID__` is substituted. */
export const WINDOWS_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class TavernLensWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public static bool ParentAlive(int pid) {
    try { Process p = Process.GetProcessById(pid); return !p.HasExited; } catch { return false; }
  }
  // Physical pixels on every monitor. A system-DPI-aware caller gets coordinates of a
  // window on a monitor with another scale factor rescaled to the system DPI, which
  // screenToDipRect would then convert a second time.
  public static void UsePhysicalPixels() {
    try {
      if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return; // PER_MONITOR_AWARE_V2 (Win10 1703+)
      if (SetThreadDpiAwarenessContext(new IntPtr(-3)) != IntPtr.Zero) return; // PER_MONITOR_AWARE (Win10 1607)
    } catch (EntryPointNotFoundException) { }
    SetProcessDPIAware(); // older Windows: system DPI only
  }
  public static string Poll() {
    UsePhysicalPixels();
    IntPtr h = FindWindow("UnityWndClass", "Hearthstone");
    if (h == IntPtr.Zero) return "{\"found\":false}";
    bool focused = GetForegroundWindow() == h;
    bool minimized = IsIconic(h);
    RECT r;
    POINT p = new POINT();
    if (minimized || !GetClientRect(h, out r) || !ClientToScreen(h, ref p)) {
      return "{\"found\":true,\"focused\":" + (focused ? "true" : "false") + ",\"minimized\":" + (minimized ? "true" : "false") + "}";
    }
    return "{\"found\":true,\"focused\":" + (focused ? "true" : "false") + ",\"minimized\":false,\"x\":" + p.X + ",\"y\":" + p.Y + ",\"w\":" + (r.Right - r.Left) + ",\"h\":" + (r.Bottom - r.Top) + "}";
  }
}
'@
[TavernLensWin]::UsePhysicalPixels()
$parentPid = __PARENT_PID__
$n = 0
while ($true) {
  [Console]::Out.WriteLine([TavernLensWin]::Poll())
  [Console]::Out.Flush()
  $n++
  if (($n % 8) -eq 0 -and -not [TavernLensWin]::ParentAlive($parentPid)) { exit 0 }
  Start-Sleep -Milliseconds 250
}
`;

/** One line of stdin for `powershell -Command -`: decodes and runs the helper script. */
export function buildWindowsHelperCommand(parentPid: number): string {
  const script = WINDOWS_HELPER_SCRIPT.replace('__PARENT_PID__', String(parentPid));
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  // Trailing blank line terminates any pending multi-line parse in `-Command -` mode.
  return `& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))))\n\n`;
}

interface RawHelperInfo {
  found: boolean;
  focused?: boolean;
  minimized?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** Parses one helper JSON line into GameWindowInfo (bounds still in physical px). */
export function parseHelperLine(line: string): GameWindowInfo | undefined {
  const t = line.trim();
  if (!t.startsWith('{')) return undefined;
  let raw: RawHelperInfo;
  try {
    raw = JSON.parse(t) as RawHelperInfo;
  } catch {
    return undefined;
  }
  if (typeof raw?.found !== 'boolean') return undefined;
  if (!raw.found) return { ...NOT_FOUND };
  const info: GameWindowInfo = { found: true, focused: !!raw.focused, minimized: !!raw.minimized };
  if (
    !info.minimized &&
    [raw.x, raw.y, raw.w, raw.h].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (raw.w as number) > 0 &&
    (raw.h as number) > 0
  ) {
    info.bounds = { x: raw.x!, y: raw.y!, width: raw.w!, height: raw.h! };
  }
  return info;
}

/** macOS osascript (AppleScript) returning `notrunning` or `front,x,y,w,h,fullscreen`. */
export const MAC_APPLESCRIPT = `
tell application "System Events"
  if not (exists process "Hearthstone") then return "notrunning"
  set p to process "Hearthstone"
  set fm to frontmost of p
  if (count of windows of p) is 0 then return (fm as text) & ",,,,,"
  set w to window 1 of p
  set {px, py} to position of w
  set {sw, sh} to size of w
  set fs to false
  try
    set fs to value of attribute "AXFullScreen" of w
  end try
  return (fm as text) & "," & px & "," & py & "," & sw & "," & sh & "," & (fs as text)
end tell`;

const MAC_TITLE_BAR = 28;

export function parseMacOutput(out: string): GameWindowInfo | undefined {
  const t = out.trim();
  if (t === 'notrunning') return { ...NOT_FOUND };
  const parts = t.split(',').map((s) => s.trim());
  if (parts.length < 6 || !/^(true|false)$/.test(parts[0])) return undefined;
  const focused = parts[0] === 'true';
  const [x, y, w, h] = parts.slice(1, 5).map(Number);
  const info: GameWindowInfo = { found: true, focused, minimized: false };
  if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
    const fullscreen = parts[5] === 'true';
    const bar = fullscreen ? 0 : MAC_TITLE_BAR;
    info.bounds = { x, y: y + bar, width: w, height: Math.max(1, h - bar) };
  } else if (parts[1] === '') {
    info.minimized = true; // running but no visible window
  }
  return info;
}

export interface WindowTrackerOptions {
  onChange: (info: GameWindowInfo) => void;
  /** Physical px -> DIP (Windows). Defaults to identity. */
  toDip?: (rect: Rect) => Rect;
  platform?: NodeJS.Platform;
}

export class GameWindowTracker {
  private _info: GameWindowInfo = { ...NOT_FOUND };
  private child: ChildProcessWithoutNullStreams | undefined;
  private stopped = true;
  private restartDelay = 1000;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private macBusy = false;
  private macDenied = false;
  private macDeniedRetryAt = 0;
  private lastKey = '';
  readonly platform: NodeJS.Platform;

  constructor(private readonly opts: WindowTrackerOptions) {
    this.platform = opts.platform ?? process.platform;
  }

  /** Whether this platform can locate the game window. */
  get supported(): boolean {
    return this.platform === 'win32' || this.platform === 'darwin';
  }

  get info(): GameWindowInfo {
    return this._info;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.platform === 'win32') this.spawnWindowsHelper();
    else if (this.platform === 'darwin') {
      this.pollTimer = setInterval(() => this.pollMac(), 500);
      this.pollMac();
    } else this.emit({ ...NOT_FOUND });
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.restartTimer = undefined;
    this.pollTimer = undefined;
    const c = this.child;
    this.child = undefined;
    if (c && !c.killed) {
      try {
        c.kill();
      } catch {
        /* ignore */
      }
    }
  }

  private emit(info: GameWindowInfo): void {
    const key = JSON.stringify(info);
    this._info = info;
    if (key === this.lastKey) return;
    this.lastKey = key;
    try {
      this.opts.onChange(info);
    } catch (err) {
      log.error('onChange failed', err);
    }
  }

  private convert(info: GameWindowInfo): GameWindowInfo {
    if (!info.bounds || !this.opts.toDip) return info;
    try {
      const r = this.opts.toDip(info.bounds);
      return {
        ...info,
        bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      };
    } catch {
      return info;
    }
  }

  // ----------------------------------------------------------------- Windows
  private spawnWindowsHelper(): void {
    if (this.stopped) return;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
        windowsHide: true,
        stdio: 'pipe',
      });
    } catch (err) {
      log.error('could not start PowerShell helper', err);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    const startedAt = Date.now();
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const info = parseHelperLine(line);
        if (info) {
          this.restartDelay = 1000;
          this.emit(this.convert(info));
        }
      }
      if (buf.length > 65536) buf = '';
    });
    let errText = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      if (errText.length < 4000) errText += c;
    });
    child.on('error', (err) => log.warn('PowerShell helper error', err));
    child.on('exit', (code) => {
      if (this.child === child) this.child = undefined;
      if (this.stopped) return;
      log.warn(
        `PowerShell helper exited (code ${code}) after ${Math.round((Date.now() - startedAt) / 1000)} s` +
          (errText ? `: ${errText.trim().slice(0, 500)}` : ''),
      );
      this.emit({ ...NOT_FOUND });
      this.scheduleRestart();
    });
    child.stdin.on('error', () => undefined);
    child.stdin.write(buildWindowsHelperCommand(process.pid));
    // Keep stdin open: closing it would end the `-Command -` session.
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    const delay = this.restartDelay;
    this.restartDelay = Math.min(30000, this.restartDelay * 2);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.spawnWindowsHelper();
    }, delay);
  }

  // ------------------------------------------------------------------- macOS
  /** Fallback without Accessibility permission: is the process running at all? */
  private pollMacProcess(done: () => void): void {
    execFile('pgrep', ['-x', 'Hearthstone'], { timeout: 2000 }, (err) => {
      done();
      if (this.stopped) return;
      const running = !err;
      this.emit(running ? { found: true, focused: true, minimized: false } : { ...NOT_FOUND });
    });
  }

  private pollMac(): void {
    if (this.macBusy || this.stopped) return;
    this.macBusy = true;
    const done = () => (this.macBusy = false);
    if (this.macDenied && Date.now() < this.macDeniedRetryAt) {
      this.pollMacProcess(done);
      return;
    }
    execFile('osascript', ['-e', MAC_APPLESCRIPT], { timeout: 3000 }, (err, stdout, stderr) => {
      if (err) {
        if (!this.macDenied) log.warn(`osascript failed (Accessibility permission?): ${String(stderr || err.message).trim()}`);
        this.macDenied = true;
        this.macDeniedRetryAt = Date.now() + 15000;
        // Don't assume the game runs (that flashed the overlay over the desktop on every
        // retry): ask the process list right away.
        this.pollMacProcess(done);
        return;
      }
      done();
      this.macDenied = false;
      const info = parseMacOutput(String(stdout));
      if (info) this.emit(info);
    });
  }
}
