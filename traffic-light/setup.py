#!/usr/bin/env python3
"""One-stop, clickable setup for the Agent Traffic Light.

Double-click the launcher for your OS (which just runs this file):

    macOS    ->  "Install Traffic Light.command"
    Windows  ->  "Install Traffic Light.bat"
    Linux    ->  "install.sh"   (or: python3 setup.py)

It opens a tiny window where you can install/uninstall the Claude Code and
Codex integrations, start the light, and optionally start it at login.
If a graphical toolkit isn't available it falls back to a text menu.

    python setup.py          # GUI if possible, else text menu
    python setup.py --cli     # force the text menu
"""

from __future__ import annotations

import contextlib
import io
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import install as installer       # noqa: E402  (reuse the tested install logic)

PY = sys.executable or "python3"
# The light runs from the FIXED install location, so deleting the download
# never stops it and updates never break it.
LIGHT = installer.APP_LIGHT


# ---------------------------------------------------------------------------
# Environment detection
# ---------------------------------------------------------------------------
def have_claude() -> bool:
    return (Path.home() / ".claude").exists() or bool(shutil.which("claude"))


def have_codex() -> bool:
    return (Path.home() / ".codex").exists() or bool(shutil.which("codex"))


def have_tk() -> bool:
    try:
        import tkinter  # noqa: F401
        return True
    except Exception:
        return False


def gui_python() -> str:
    """Prefer a console-less interpreter for launching the light."""
    if os.name == "nt":
        cand = Path(PY).with_name("pythonw.exe")
        if cand.exists():
            return str(cand)
    return PY


# ---------------------------------------------------------------------------
# Actions (return human-readable log text)
# ---------------------------------------------------------------------------
def _capture(fn, *args) -> str:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            fn(*args)
    except SystemExit as e:           # installer uses sys.exit on bad input
        buf.write(f"\n[stopped] {e}\n")
    except Exception as e:            # never let setup crash on one action
        buf.write(f"\n[error] {e}\n")
    return buf.getvalue()


def do_install(claude: bool, codex: bool, autostart: bool) -> str:
    if not (claude or codex):
        claude = True  # nothing ticked -> at least set up Claude Code
    out = "Installing...\n"
    installer.sync_app()
    if claude:
        out += _capture(installer.claude, True)
    if codex:
        out += _capture(installer.codex, True)
    if autostart:
        out += enable_autostart()
    out += "\nDone. Restart your agent(s) so they pick up the changes."
    return out


def do_all(claude: bool, codex: bool, autostart: bool = True) -> str:
    """One click: install + (optional) auto-start at login + launch the light."""
    out = do_install(claude, codex, autostart)
    out += "\n" + start_light()
    out += ("\n\n✅ All set. Now RESTART Claude Code (Cmd+Q, reopen) so it "
            "loads the hooks. The light turns green when a session connects.")
    return out


def do_uninstall(claude: bool, codex: bool) -> str:
    out = "Uninstalling...\n"
    if claude:
        out += _capture(installer.claude, False)
    if codex:
        out += _capture(installer.codex, False)
    out += disable_autostart()
    return out


def start_light() -> str:
    if not LIGHT.exists():
        installer.sync_app()   # make sure the fixed-location copy exists
    if not LIGHT.exists():
        return f"[error] {LIGHT} not found"
    try:
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = 0x00000008  # DETACHED_PROCESS
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([gui_python(), str(LIGHT)], **kwargs)
        return "Started the traffic light. (Drag it; right-click/Esc/q to quit.)"
    except Exception as e:
        return f"[error] could not start the light: {e}"


# ---------------------------------------------------------------------------
# "Start at login" autostart, per platform
# ---------------------------------------------------------------------------
MAC_PLIST = Path.home() / "Library" / "LaunchAgents" / "com.agent.trafficlight.plist"
LINUX_DESKTOP = Path.home() / ".config" / "autostart" / "agent-traffic-light.desktop"
WIN_STARTUP = (
    Path(os.environ.get("APPDATA", Path.home())) /
    "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" /
    "AgentTrafficLight.bat"
)


def enable_autostart() -> str:
    try:
        if sys.platform == "darwin":
            MAC_PLIST.parent.mkdir(parents=True, exist_ok=True)
            MAC_PLIST.write_text(
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
                '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
                '<plist version="1.0"><dict>\n'
                '  <key>Label</key><string>com.agent.trafficlight</string>\n'
                '  <key>ProgramArguments</key>\n'
                f'  <array><string>{gui_python()}</string>'
                f'<string>{LIGHT}</string></array>\n'
                '  <key>RunAtLoad</key><true/>\n'
                '</dict></plist>\n', encoding="utf-8")
            subprocess.run(["launchctl", "unload", str(MAC_PLIST)],
                           capture_output=True)
            subprocess.run(["launchctl", "load", str(MAC_PLIST)],
                           capture_output=True)
            return f"\nStart-at-login enabled ({MAC_PLIST.name}).\n"

        if os.name == "nt":
            WIN_STARTUP.parent.mkdir(parents=True, exist_ok=True)
            WIN_STARTUP.write_text(
                f'@echo off\r\nstart "" "{gui_python()}" "{LIGHT}"\r\n',
                encoding="utf-8")
            return f"\nStart-at-login enabled ({WIN_STARTUP.name}).\n"

        # Linux / other XDG desktops
        LINUX_DESKTOP.parent.mkdir(parents=True, exist_ok=True)
        LINUX_DESKTOP.write_text(
            "[Desktop Entry]\nType=Application\nName=Agent Traffic Light\n"
            f"Exec={gui_python()} {LIGHT}\n"
            "X-GNOME-Autostart-enabled=true\nTerminal=false\n",
            encoding="utf-8")
        return f"\nStart-at-login enabled ({LINUX_DESKTOP.name}).\n"
    except Exception as e:
        return f"\n[error] could not enable start-at-login: {e}\n"


def disable_autostart() -> str:
    removed = []
    for p in (MAC_PLIST, LINUX_DESKTOP, WIN_STARTUP):
        try:
            if p.exists():
                if p == MAC_PLIST:
                    subprocess.run(["launchctl", "unload", str(p)],
                                   capture_output=True)
                p.unlink()
                removed.append(p.name)
        except Exception:
            pass
    return f"\nDisabled start-at-login ({', '.join(removed)}).\n" if removed else ""


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------
def launch_gui() -> None:
    import tkinter as tk

    root = tk.Tk()
    root.title("Agent Traffic Light — Setup")
    root.configure(bg="#161619")
    root.resizable(False, False)

    fg, sub, accent = "#f2f2f7", "#8e8e93", "#30d158"

    def L(parent, text, **kw):
        kw.setdefault("bg", "#161619")
        kw.setdefault("fg", fg)
        return tk.Label(parent, text=text, **kw)

    L(root, "\U0001F6A6  Agent Traffic Light",
      font=("Helvetica", 16, "bold")).grid(row=0, column=0, columnspan=2,
                                            sticky="w", padx=16, pady=(14, 2))
    detected = []
    detected.append(("Claude Code", have_claude()))
    detected.append(("Codex", have_codex()))
    found = ", ".join(n for n, ok in detected if ok) or "none auto-detected"
    L(root, f"Detected: {found}", fg=sub, font=("Helvetica", 9)).grid(
        row=1, column=0, columnspan=2, sticky="w", padx=16)

    claude_v = tk.BooleanVar(value=have_claude() or not have_codex())
    codex_v = tk.BooleanVar(value=have_codex())
    auto_v = tk.BooleanVar(value=True)   # friendly default: start with your Mac

    opts = tk.Frame(root, bg="#161619")
    opts.grid(row=2, column=0, columnspan=2, sticky="w", padx=14, pady=8)
    ck = dict(bg="#161619", fg=fg, selectcolor="#2a2a30",
              activebackground="#161619", activeforeground=fg, anchor="w")
    tk.Checkbutton(opts, text="Claude Code", variable=claude_v, **ck).grid(
        row=0, column=0, sticky="w")
    tk.Checkbutton(opts, text="Codex", variable=codex_v, **ck).grid(
        row=1, column=0, sticky="w")
    tk.Checkbutton(opts, text="Start the light at login", variable=auto_v,
                   **ck).grid(row=2, column=0, sticky="w")

    log = tk.Text(root, width=58, height=12, bg="#0a0a0c", fg=fg,
                  insertbackground=fg, relief="flat", font=("Menlo", 9),
                  wrap="word")
    log.grid(row=4, column=0, columnspan=2, padx=14, pady=(6, 12))
    log.insert("end", "Just click  “Install & Start”  — that sets everything up "
                      "and opens the light.\nThen restart Claude Code once.\n")
    log.configure(state="disabled")

    def show(text: str) -> None:
        log.configure(state="normal")
        log.insert("end", "\n" + text.strip() + "\n")
        log.see("end")
        log.configure(state="disabled")

    btns = tk.Frame(root, bg="#161619")
    btns.grid(row=3, column=0, columnspan=2, padx=14, pady=2, sticky="w")

    def mkbtn(text, cmd, col, bg="#2a2a30"):
        b = tk.Button(btns, text=text, command=cmd, bg=bg, fg=fg,
                      activebackground="#3a3a40", activeforeground=fg,
                      relief="flat", padx=12, pady=5, highlightthickness=0,
                      font=("Helvetica", 10, "bold"))
        b.grid(row=0, column=col, padx=4)
        return b

    mkbtn("✓ Install & Start", lambda: show(
        do_all(claude_v.get(), codex_v.get(), auto_v.get())), 0, bg="#1f6f3a")
    mkbtn("Start light", lambda: show(start_light()), 1)
    mkbtn("Uninstall", lambda: show(
        do_uninstall(claude_v.get(), codex_v.get())), 2)
    mkbtn("Quit", root.destroy, 3)

    root.mainloop()


# ---------------------------------------------------------------------------
# Text-menu fallback
# ---------------------------------------------------------------------------
def cli() -> None:
    print("\n\U0001F6A6  Agent Traffic Light setup")
    print(f"   Detected: Claude Code={have_claude()}  Codex={have_codex()}\n")
    menu = (
        "  1) Install & Start  (recommended: sets up + auto-start + opens the light)\n"
        "  2) Install for Claude Code only\n"
        "  3) Install for Codex only\n"
        "  4) Start the light now\n"
        "  5) Uninstall everything\n"
        "  0) Quit\n"
    )
    while True:
        print(menu)
        try:
            choice = input("Choose: ").strip()
        except (EOFError, KeyboardInterrupt):
            return
        if choice == "1":
            print(do_all(have_claude() or not have_codex(), have_codex()))
        elif choice == "2":
            print(do_install(True, False, False))
        elif choice == "3":
            print(do_install(False, True, False))
        elif choice == "4":
            print(start_light())
        elif choice == "5":
            print(do_uninstall(True, True))
        elif choice == "0":
            return
        else:
            print("  ? please pick a number from the menu")


def main() -> None:
    if "--cli" not in sys.argv[1:] and have_tk():
        try:
            launch_gui()
            return
        except Exception as e:
            print(f"(GUI unavailable: {e}; falling back to text menu)")
    cli()


if __name__ == "__main__":
    main()
