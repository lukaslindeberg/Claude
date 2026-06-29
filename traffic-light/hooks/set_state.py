#!/usr/bin/env python3
"""Write the traffic-light state. Called by Claude Code hooks.

Usage:
    python set_state.py <red|yellow|green|off>

Writes the given word to the state file that traffic_light.py polls.
Honors TRAFFIC_LIGHT_STATE_FILE; defaults to ~/.claude/traffic_light.state.
Never fails loudly (a broken hook must not block Claude Code).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def state_file_path() -> Path:
    env = os.environ.get("TRAFFIC_LIGHT_STATE_FILE")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".claude" / "traffic_light.state"


def main() -> int:
    state = (sys.argv[1] if len(sys.argv) > 1 else "off").strip().lower()
    path = state_file_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(state + "\n", encoding="utf-8")
    except OSError as exc:  # pragma: no cover
        sys.stderr.write(f"traffic-light: could not write state: {exc}\n")
        return 0  # don't break Claude Code over a status indicator
    return 0


if __name__ == "__main__":
    sys.exit(main())
