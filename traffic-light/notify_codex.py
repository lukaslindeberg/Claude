#!/usr/bin/env python3
"""Codex `notify` program: turns the traffic light GREEN when a turn ends.

Codex calls this with a single JSON argument. Today Codex only emits the
`agent-turn-complete` event to external notify programs (approval/turn-start
events are not delivered), so this maps that one event to "done" (green).

Configure in ~/.codex/config.toml:
    notify = ["python3", "/abs/path/to/notify_codex.py"]

Never fails loudly so it can't disrupt Codex.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_state  # noqa: E402


def main() -> int:
    payload = {}
    if len(sys.argv) > 1:
        try:
            payload = json.loads(sys.argv[1])
        except (ValueError, TypeError):
            payload = {}

    event = str(payload.get("type", "")).lower()
    # agent-turn-complete is currently the only event Codex sends here.
    if event in ("agent-turn-complete", "turn-complete", "", "agent-turn"):
        agent_state.write_state("codex", agent_state.GREEN)
    return 0


if __name__ == "__main__":
    sys.exit(main())
