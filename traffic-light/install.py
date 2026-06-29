#!/usr/bin/env python3
"""Wire the traffic light into Claude Code and/or Codex.

    python install.py                # install for both (whatever is present)
    python install.py --claude-only
    python install.py --codex-only
    python install.py --uninstall    # remove from both

Claude Code: merges hooks into ~/.claude/settings.json.
Codex:       adds a `notify` program to ~/.codex/config.toml.

Existing settings are preserved; a timestamped backup is written before any
change. Safe to re-run (idempotent).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SET_STATE = HERE / "set_state.py"
NOTIFY_CODEX = HERE / "notify_codex.py"
PY = sys.executable or "python3"

CLAUDE_SETTINGS = Path.home() / ".claude" / "settings.json"
CODEX_CONFIG = Path.home() / ".codex" / "config.toml"

# Claude Code: event -> state word
CLAUDE_EVENTS = {
    "UserPromptSubmit": "red",   # you sent a prompt -> Claude starts working
    "PreToolUse": "red",         # running a tool (edit/bash/...)
    "Notification": "yellow",    # needs your approval / input
    "Stop": "green",             # finished its turn
}
MATCHED_EVENTS = {"PreToolUse"}


def _backup(path: Path) -> None:
    if path.exists():
        b = path.with_name(path.name + f".bak-{int(time.time())}")
        shutil.copy2(path, b)
        print(f"  backed up {path.name} -> {b.name}")


# --------------------------------------------------------------------------
# Claude Code
# --------------------------------------------------------------------------
def _claude_cmd(state: str) -> str:
    return f'"{PY}" "{SET_STATE}" {state} --source claude'


def _is_ours_claude(group: dict) -> bool:
    return any("set_state.py" in str(h.get("command", ""))
               for h in group.get("hooks", []))


def _strip_claude(hooks: dict) -> None:
    for ev in list(hooks):
        keep = [g for g in hooks[ev] if not _is_ours_claude(g)]
        if keep:
            hooks[ev] = keep
        else:
            del hooks[ev]


def claude(install: bool) -> None:
    if install and not SET_STATE.exists():
        sys.exit(f"error: cannot find {SET_STATE}")
    data = {}
    if CLAUDE_SETTINGS.exists():
        try:
            data = json.loads(CLAUDE_SETTINGS.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            sys.exit(f"error: {CLAUDE_SETTINGS} is not valid JSON; fix it first.")
    hooks = data.setdefault("hooks", {})
    _strip_claude(hooks)

    if install:
        for ev, state in CLAUDE_EVENTS.items():
            group: dict = {"hooks": [{"type": "command", "command": _claude_cmd(state)}]}
            if ev in MATCHED_EVENTS:
                group["matcher"] = "*"
            hooks.setdefault(ev, []).append(group)
    if not hooks:
        data.pop("hooks", None)

    CLAUDE_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    _backup(CLAUDE_SETTINGS)
    CLAUDE_SETTINGS.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"  {'installed' if install else 'removed'} Claude Code hooks "
          f"in {CLAUDE_SETTINGS}")


# --------------------------------------------------------------------------
# Codex
# --------------------------------------------------------------------------
NOTIFY_LINE_RE = re.compile(r"^\s*notify\s*=", re.MULTILINE)


def _codex_line() -> str:
    # TOML literal strings ('...') need no escaping for Windows backslashes.
    return f"notify = ['{PY}', '{NOTIFY_CODEX}']"


def codex(install: bool) -> None:
    if install and not NOTIFY_CODEX.exists():
        sys.exit(f"error: cannot find {NOTIFY_CODEX}")
    text = ""
    if CODEX_CONFIG.exists():
        text = CODEX_CONFIG.read_text(encoding="utf-8")

    # drop any line we added before
    kept = [ln for ln in text.splitlines() if "notify_codex.py" not in ln]
    stripped = "\n".join(kept)

    # a different notify already configured? don't clobber it.
    if install and NOTIFY_LINE_RE.search(stripped):
        print("  ! ~/.codex/config.toml already has a `notify` set by something "
              "else; left untouched.")
        print(f"    To use the light, set it to:  {_codex_line()}")
        return

    if install:
        # root keys must precede tables in TOML, so prepend at the very top.
        new = _codex_line() + "\n" + (stripped if stripped.strip() else "")
        new = new.rstrip("\n") + "\n"
    else:
        new = stripped.rstrip("\n")
        new = (new + "\n") if new else ""

    CODEX_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    _backup(CODEX_CONFIG)
    CODEX_CONFIG.write_text(new, encoding="utf-8")
    print(f"  {'installed' if install else 'removed'} Codex notify "
          f"in {CODEX_CONFIG}")


# --------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--claude-only", action="store_true")
    ap.add_argument("--codex-only", action="store_true")
    args = ap.parse_args()

    do_claude = not args.codex_only
    do_codex = not args.claude_only
    install = not args.uninstall

    print("Uninstalling..." if not install else "Installing traffic-light integration...")
    if do_claude:
        claude(install)
    if do_codex:
        codex(install)

    if install:
        print("\nDone. Restart your agent(s) to load the changes, then run:")
        print(f"  {PY} {HERE / 'traffic_light.py'}")
        print("Preview the look any time with:  "
              f"{PY} {HERE / 'traffic_light.py'} --demo")
    else:
        print("\nRemoved. (State files in ~/.agent-traffic-light can be deleted "
              "manually.)")


if __name__ == "__main__":
    main()
