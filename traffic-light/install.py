#!/usr/bin/env python3
"""Wire the traffic light into Claude Code by merging hooks into settings.json.

Run once:
    python install.py            # installs into ~/.claude/settings.json
    python install.py --uninstall  # removes the traffic-light hooks again

The hooks call hooks/set_state.py to set red/yellow/green as Claude works.
Existing hooks and settings are preserved; only our entries are added or
removed. Safe to re-run (idempotent).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SET_STATE = HERE / "hooks" / "set_state.py"
SETTINGS = Path.home() / ".claude" / "settings.json"

# event name -> state word written when the event fires
EVENT_STATE = {
    "UserPromptSubmit": "red",   # user sent a prompt: Claude starts working
    "PreToolUse": "red",         # running a tool (editing, bash, etc.)
    "Notification": "yellow",    # needs your approval / input
    "Stop": "green",             # finished its turn
}
# events that take a tool matcher
MATCHED_EVENTS = {"PreToolUse"}


def command_for(state: str) -> str:
    # Quote paths so spaces in the path are handled.
    return f'"{sys.executable}" "{SET_STATE}" {state}'


def is_ours(hook_group: dict) -> bool:
    for h in hook_group.get("hooks", []):
        if "set_state.py" in str(h.get("command", "")):
            return True
    return False


def load_settings() -> dict:
    if SETTINGS.exists():
        try:
            return json.loads(SETTINGS.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            sys.exit(f"error: {SETTINGS} is not valid JSON; fix it first.")
    return {}


def save_settings(data: dict) -> None:
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    if SETTINGS.exists():
        backup = SETTINGS.with_suffix(f".json.bak-{int(time.time())}")
        shutil.copy2(SETTINGS, backup)
        print(f"backed up existing settings -> {backup}")
    SETTINGS.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def strip_ours(hooks: dict) -> None:
    """Remove any previously-installed traffic-light hook groups."""
    for event in list(hooks.keys()):
        groups = [g for g in hooks[event] if not is_ours(g)]
        if groups:
            hooks[event] = groups
        else:
            del hooks[event]


def install() -> None:
    if not SET_STATE.exists():
        sys.exit(f"error: cannot find {SET_STATE}")
    data = load_settings()
    hooks = data.setdefault("hooks", {})
    strip_ours(hooks)  # keep idempotent

    for event, state in EVENT_STATE.items():
        group: dict = {"hooks": [{"type": "command", "command": command_for(state)}]}
        if event in MATCHED_EVENTS:
            group["matcher"] = "*"
        hooks.setdefault(event, []).append(group)

    save_settings(data)
    print("Installed traffic-light hooks. Restart Claude Code to pick them up.")
    print(f"Then run:  {sys.executable} {HERE / 'traffic_light.py'}")


def uninstall() -> None:
    data = load_settings()
    hooks = data.get("hooks", {})
    strip_ours(hooks)
    if not hooks:
        data.pop("hooks", None)
    save_settings(data)
    print("Removed traffic-light hooks.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uninstall", action="store_true", help="remove the hooks")
    args = parser.parse_args()
    (uninstall if args.uninstall else install)()


if __name__ == "__main__":
    main()
