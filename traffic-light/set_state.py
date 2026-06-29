#!/usr/bin/env python3
"""Set an agent's traffic-light state. Called by Claude Code hooks.

Usage:
    python set_state.py <red|yellow|green|off> [--source NAME]

NAME defaults to "claude". The state is written so the traffic-light window
can show it. This never fails loudly so it can't block the agent.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_state  # noqa: E402


def main() -> int:
    args = [a for a in sys.argv[1:]]
    source = "claude"
    if "--source" in args:
        i = args.index("--source")
        try:
            source = args[i + 1]
            del args[i:i + 2]
        except IndexError:
            pass
    state = args[0] if args else "off"
    agent_state.write_state(source, state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
