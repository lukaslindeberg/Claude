#!/usr/bin/env python3
"""Set an agent session's traffic-light state. Called by Claude Code hooks.

Usage:
    python set_state.py <red|yellow|green|off> [--source NAME]

NAME defaults to "claude". When invoked as a hook, the agent passes a JSON
payload on stdin; if it contains a session_id we scope the state to that
session (so many concurrent sessions each light up independently). "off"
disconnects the session. Never fails loudly so it can't block the agent.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_state  # noqa: E402


def _stdin_json() -> dict:
    """Read the hook payload from stdin without ever blocking on a tty."""
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return {}
        if os.name == "posix":
            import select
            ready, _, _ = select.select([sys.stdin], [], [], 0.1)
            if not ready:
                return {}
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def _session_suffix() -> str:
    sid = str(_stdin_json().get("session_id", "")).strip()
    return f"-{sid[:8]}" if sid else ""


def main() -> int:
    args = list(sys.argv[1:])
    source = "claude"
    if "--source" in args:
        i = args.index("--source")
        try:
            source = args[i + 1]
            del args[i:i + 2]
        except IndexError:
            pass
    state = args[0] if args else "off"

    source = source + _session_suffix()
    agent_state.write_state(source, state)  # write_state removes file for "off"
    return 0


if __name__ == "__main__":
    sys.exit(main())
